import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName
    this.children = []
    this.parentNode = null
    this.attributes = new Map()
    this.listeners = new Map()
    this.classList = {
      values: new Set(),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classList.values.has(name) : force
        if (enabled) this.classList.values.add(name)
        else this.classList.values.delete(name)
      },
    }
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parentNode = this } }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child }
  remove() { this.parentNode?.removeChild(this) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  addEventListener(name, handler) { this.listeners.set(name, handler) }
  get firstChild() { return this.children[0] }
  set textContent(value) { this.children = []; this.text = String(value) }
  get textContent() { return this.text ?? this.children.map(child => child.textContent ?? '').join('') }
}

function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children) { const result = find(child, predicate); if (result) return result }
  return undefined
}

class FakeDocument extends FakeNode {
  constructor() { super('#document'); this.head = new FakeNode('head'); this.body = new FakeNode('body'); this.append(this.head, this.body) }
  createElement(tagName) { return new FakeNode(tagName) }
  createTextNode(text) { const node = new FakeNode('#text'); node.textContent = text; return node }
  querySelector(selector) { return selector === '[data-dsh-task-orchestrator-board]' ? (find(this, node => node.attributes.has('data-dsh-task-orchestrator-board')) ?? null) : null }
}

test('bundled DSH client registers and mounts the standalone board', async () => {
  const document = new FakeDocument()
  let registration
  let effectCleanup
  let fetchCalls = 0
  const context = {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    document,
    Node: FakeNode,
    console,
    URLSearchParams,
    fetch: async () => { fetchCalls++; return { ok: true, status: 200, async json() { return { tasks: [] } } } },
  }
  context.globalThis = context
  vm.runInNewContext(await readFile('lib/client.js', 'utf8'), context)
  assert.equal(registration?.id, 'dsh-task-orchestrator')
  const exports = registration.factory(() => { throw new Error('unexpected external require') })
  assert.equal(typeof exports.apply, 'function')
  exports.apply({ effect(factory) { effectCleanup = factory(); return effectCleanup } })
  await Promise.resolve()
  await Promise.resolve()
  assert.ok(document.querySelector('[data-dsh-task-orchestrator-board]'))
  assert.ok(fetchCalls >= 1)
  effectCleanup?.()
})
