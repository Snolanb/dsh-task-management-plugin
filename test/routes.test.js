import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskStore } from '../src/store.js'
import { handleRequest } from '../src/routes.js'
import { WorkerSpecRegistry } from '../src/worker-specs.js'

function request(store, method, url, payload, remoteAddress = '127.0.0.1', dependencies = {}) {
  const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)])
  req.method = method
  req.url = url
  req.socket = { remoteAddress }
  let body = ''
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(value = '') { body += value },
  }
  return handleRequest(store, req, res, dependencies).then(() => ({ status: res.status, headers: res.headers, body: JSON.parse(body) }))
}

test('serves loopback task CRUD, lifecycle, and dispatcher routes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-route-'))
  const store = new TaskStore({ dbPath: join(dir, 'tasks.db') })
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const created = await request(store, 'POST', '/api/task-orchestrator/tasks', { id: 'http-task', title: 'HTTP task', status: 'ready' })
  assert.equal(created.status, 200)
  assert.equal(created.body.task.id, 'http-task')
  assert.equal(created.headers['content-type'], 'application/json; charset=utf-8')

  const listed = await request(store, 'GET', '/api/task-orchestrator/dispatcher/ready')
  assert.deepEqual(listed.body.tasks.map(task => task.id), ['http-task'])
  const registry = new WorkerSpecRegistry({ ornith: { mode: 'headless-profile', profile: 'ornith-filemount-worker', provider: 'ollama', model: 'ornith-1.5:9b' } })
  const workers = await request(store, 'GET', '/api/task-orchestrator/dispatcher/workers', undefined, '127.0.0.1', { registry })
  assert.equal(workers.body.workers[0].name, 'ornith')
  const preflight = await request(store, 'POST', '/api/task-orchestrator/dispatcher/preflight', { worker_profile: 'ornith', workspace: '/workspace' }, '127.0.0.1', { preflight: async input => ({ ok: input.worker_profile === 'ornith', checks: [] }) })
  assert.equal(preflight.body.preflight.ok, true)
  const claimed = await request(store, 'POST', '/api/task-orchestrator/tasks/http-task/claim', { worker: 'http-worker' })
  assert.equal(claimed.body.claimed, true)
  await request(store, 'POST', '/api/task-orchestrator/tasks/http-task/start', { worker: 'http-worker' })
  const completed = await request(store, 'POST', '/api/task-orchestrator/tasks/http-task/complete', { worker: 'http-worker', result_summary: 'done', tests_run: ['node --test'] })
  assert.equal(completed.body.task.status, 'in_review')
  const events = await request(store, 'GET', '/api/task-orchestrator/tasks/http-task/events')
  assert.ok(events.body.events.some(event => event.event_type === 'task_completed'))
  const missing = await request(store, 'GET', '/api/task-orchestrator/tasks/missing')
  assert.equal(missing.status, 404)
  const missingWorker = await request(store, 'POST', '/api/task-orchestrator/tasks/http-task/claim', {})
  assert.equal(missingWorker.status, 400)
  const malformedPath = await request(store, 'GET', '/api/task-orchestrator/tasks/%E0%A4%A')
  assert.equal(malformedPath.status, 400)
})

test('rejects non-loopback HTTP requests', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-route-'))
  const store = new TaskStore({ dbPath: join(dir, 'tasks.db') })
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  const response = await request(store, 'GET', '/api/task-orchestrator/tasks', undefined, '192.0.2.10')
  assert.equal(response.status, 403)
})
