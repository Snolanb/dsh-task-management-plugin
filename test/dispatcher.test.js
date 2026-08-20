import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TaskStore } from '../src/store.js'
import { WorkerDispatcher, buildTaskPrompt } from '../src/dispatcher.js'
import { WorkerSpecRegistry } from '../src/worker-specs.js'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-dispatcher-'))
  const store = new TaskStore({ dbPath: join(dir, 'tasks.db') })
  const registry = new WorkerSpecRegistry({
    worker: {
      mode: 'headless-profile', profile: 'worker-profile', provider: 'ollama', model: 'worker-model',
      workspacePolicy: 'any', timeoutMs: 1000, leaseSeconds: 30,
    },
  })
  return { dir, store, registry, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function readyTask(f, id = 'dispatch-task') {
  return f.store.create({
    id, title: 'Dispatch task', description: 'Do the bounded work.', status: 'ready', workspace: f.dir,
    worker_profile: 'worker', acceptance_criteria: ['change the file', 'run the tests'],
  })
}

test('dispatches a task through claim, start, lease ownership, and completion', async t => {
  const f = fixture(); t.after(() => f.cleanup())
  const task = readyTask(f)
  const launches = []
  const dispatcher = new WorkerDispatcher({
    store: f.store,
    registry: f.registry,
    idFactory: () => 'run-1',
    actor: 'test-dispatcher',
    preflight: async () => ({ ok: true, spec: f.registry.get('worker') }),
    launcher: { async launch(input) { launches.push(input); return { wait: async () => ({ exitCode: 0, stdout: 'worker completed', stderr: '' }), async terminate() {} } } },
  })
  const result = await dispatcher.dispatchOnce({ workerProfile: 'worker' })
  assert.equal(result.status, 'in_review')
  assert.equal(result.task.status, 'in_review')
  assert.equal(result.task.attempts, 1)
  assert.equal(result.worker, 'worker:run-1')
  assert.equal(launches[0].task.id, task.id)
  assert.match(launches[0].runId, /^worker:run-1$/)
  assert.match(result.task.result_summary, /worker completed/)
  assert.ok(f.store.events(task.id).some(event => event.event_type === 'task_claimed'))
  assert.ok(f.store.events(task.id).some(event => event.event_type === 'task_started'))
})

test('does not consume an attempt when preflight fails', async t => {
  const f = fixture(); t.after(() => f.cleanup())
  const task = readyTask(f)
  const dispatcher = new WorkerDispatcher({
    store: f.store,
    registry: f.registry,
    preflight: async () => ({ ok: false, blockers: [{ code: 'MODEL_UNAVAILABLE', message: 'not loaded' }] }),
    launcher: { async launch() { throw new Error('must not launch') } },
  })
  const result = await dispatcher.dispatchOnce({ workerProfile: 'worker' })
  assert.equal(result.reason, 'preflight_failed')
  assert.equal(result.task.id, task.id)
  assert.equal(f.store.get(task.id).status, 'ready')
  assert.equal(f.store.get(task.id).attempts, 0)
})

test('releases a claim when the worker cannot launch', async t => {
  const f = fixture(); t.after(() => f.cleanup())
  const task = readyTask(f)
  const dispatcher = new WorkerDispatcher({
    store: f.store,
    registry: f.registry,
    idFactory: () => 'run-launch-failure',
    preflight: async () => ({ ok: true, spec: f.registry.get('worker') }),
    launcher: { async launch() { throw new Error('profile failed to start') } },
  })
  const result = await dispatcher.dispatchOnce({ workerProfile: 'worker' })
  assert.equal(result.reason, 'launch_failed')
  assert.match(result.error, /profile failed to start/)
  assert.equal(f.store.get(task.id).status, 'ready')
  assert.equal(f.store.get(task.id).claimed_by, null)
  assert.equal(f.store.get(task.id).attempts, 0)
})

test('fails a task when the worker exits unsuccessfully', async t => {
  const f = fixture(); t.after(() => f.cleanup())
  const task = readyTask(f)
  const dispatcher = new WorkerDispatcher({
    store: f.store,
    registry: f.registry,
    preflight: async () => ({ ok: true, spec: f.registry.get('worker') }),
    launcher: { async launch() { return { wait: async () => ({ exitCode: 7, stdout: '', stderr: 'tests failed' }), async terminate() {} } } },
  })
  const result = await dispatcher.dispatchOnce({ workerProfile: 'worker' })
  assert.equal(result.status, 'failed')
  assert.equal(result.task.status, 'failed')
  assert.match(result.task.result_summary, /tests failed/)
  assert.deepEqual(result.task.remaining_blockers, ['worker exited unsuccessfully'])
})

test('builds a bounded task prompt from the persisted task record', () => {
  const prompt = buildTaskPrompt({
    id: 'task/one', title: 'Bounded change', description: 'Change one thing.', workspace: '/repo',
    acceptance_criteria: ['first', 'second'],
  }, { name: 'ornith-filemount' }, 'run-1')
  assert.match(prompt, /task\/one/)
  assert.match(prompt, /1\. first/)
  assert.match(prompt, /Do not modify unrelated files/)
})
