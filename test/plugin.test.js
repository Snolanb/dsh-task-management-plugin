import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

test('registers the task service, DSH tools, and HTTP route', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-plugin-'))
  const routes = []
  const registeredTools = []
  const services = new Map()
  const cleanups = []
  const ctx = {
    webServer: { register(route) { routes.push(route); return () => {} } },
    tools: { register(tool) { registeredTools.push(tool); return () => {} } },
    provide(name, value) { services.set(name, value); return () => services.delete(name) },
    effect(factory) { const cleanup = factory(); cleanups.push(cleanup); return cleanup },
  }
  t.after(() => { for (const cleanup of cleanups) cleanup(); rmSync(dir, { recursive: true, force: true }) })

  apply(ctx, { dbPath: join(dir, 'tasks.db'), defaultLeaseSeconds: 30 })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/task-orchestrator')
  assert.equal(registeredTools.length, 22)
  assert.ok(registeredTools.some(tool => tool.name === 'task_claim'))
  const api = services.get('taskOrchestrator')
  assert.ok(api)
  const task = api.create({ id: 'service-task', title: 'Service task' })
  assert.equal(api.get(task.id).title, 'Service task')
})

test('keeps the service and tools usable without webServer', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-plugin-cli-'))
  const registeredTools = []
  const services = new Map()
  const cleanups = []
  const ctx = {
    tools: { register(tool) { registeredTools.push(tool); return () => {} } },
    provide(name, value) { services.set(name, value); return () => services.delete(name) },
    effect(factory) { const cleanup = factory(); cleanups.push(cleanup); return cleanup },
  }
  t.after(() => { for (const cleanup of cleanups) cleanup(); rmSync(dir, { recursive: true, force: true }) })
  apply(ctx, { dbPath: join(dir, 'tasks.db') })
  assert.equal(registeredTools.length, 22)
  assert.ok(services.get('taskOrchestrator'))
})
