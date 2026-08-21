import test from 'node:test'
import assert from 'node:assert/strict'
import { BOARD_STATUSES, TaskOrchestratorClient } from '../src/client-api.js'

function fakeResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body } }
}

test('client builds task queries and lifecycle requests', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.includes('/tasks?')) return fakeResponse({ tasks: [{ id: 'one' }] })
    if (url.endsWith('/tasks')) return fakeResponse({ task: { id: 'created' } })
    if (url.endsWith('/claim')) return fakeResponse({ claimed: true, task: { id: 'one', status: 'claimed' } })
    return fakeResponse({ task: { id: 'one', status: 'ready' } })
  }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator/')
  assert.deepEqual(await client.list({ statuses: ['ready', 'running'], worker_profile: 'ornith' }), [{ id: 'one' }])
  assert.equal((await client.create({ title: 'Created' })).id, 'created')
  assert.equal((await client.claim('one', 'worker-1', 60)).status, 'claimed')
  assert.equal(BOARD_STATUSES.length, 11)
  assert.equal(calls[0].url, '/api/task-orchestrator/tasks?worker_profile=ornith&status=ready%2Crunning')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(JSON.parse(calls[1].init.body).title, 'Created')
})

test('client surfaces structured API errors', async () => {
  const client = new TaskOrchestratorClient(async () => fakeResponse({ error: 'lease expired', code: 'LEASE_EXPIRED' }, 409))
  await assert.rejects(() => client.start('one', 'worker'), error => error.status === 409 && error.code === 'LEASE_EXPIRED' && error.message === 'lease expired')
})

test('client delete sends DELETE with encoded id and returns API result', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    return fakeResponse({ deleted: true, id: 'abc-123' })
  }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator')
  const result = await client.delete('abc-123')
  assert.deepEqual(result, { deleted: true, id: 'abc-123' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/task-orchestrator/tasks/abc-123')
  assert.equal(calls[0].init.method, 'DELETE')
  assert.equal(calls[0].init.body, undefined)
  assert.equal(calls[0].init.headers['content-type'], undefined)
})

test('client delete URL-encodes the task id', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => { calls.push({ url, init }); return fakeResponse({ task: { id: 'x', status: 'done' } }) }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator/')
  await client.delete('task/42 #1')
  assert.equal(calls[0].url, '/api/task-orchestrator/tasks/task%2F42%20%231')
})

test('client delete includes actor only when provided', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => { calls.push({ url, init }); return fakeResponse({ deleted: true, id: 'x' }) }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator/')

  await client.delete('x')
  assert.equal(calls[0].init.body, undefined)

  calls.length = 0
  const withActor = await client.delete('x', 'ornith:worker-1')
  assert.deepEqual(withActor, { deleted: true, id: 'x' })
  assert.deepEqual(JSON.parse(calls[0].init.body), { actor: 'ornith:worker-1' })
})

test('client delete surfaces structured API errors', async () => {
  const client = new TaskOrchestratorClient(async () => fakeResponse({ error: 'not found', code: 'NOT_FOUND' }, 404))
  await assert.rejects(() => client.delete('missing'), error => error.status === 404 && error.code === 'NOT_FOUND' && error.message === 'not found')
})

test('client hits GET /dispatcher/ready for ready tasks', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    return fakeResponse({ tasks: [{ id: 'ready-1' }, { id: 'ready-2' }] })
  }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator/')
  const tasks = await client.ready({ worker_profile: 'ornith' })
  assert.deepEqual(tasks, [{ id: 'ready-1' }, { id: 'ready-2' }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/task-orchestrator/dispatcher/ready?worker_profile=ornith')
})

test('client encodes ready query options like list does', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    return fakeResponse({ tasks: [] })
  }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator')
  await client.ready({ statuses: ['ready', 'running'], limit: 5 })
  assert.equal(calls[0].url, '/api/task-orchestrator/dispatcher/ready?limit=5&status=ready%2Crunning')
})

test('client ready task ids are URL-encoded', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => { calls.push({ url, init }); return fakeResponse({ tasks: [] }) }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator/')
  await client.ready({ worker_profile: 'ornith:25!' })
  assert.equal(calls[0].url, '/api/task-orchestrator/dispatcher/ready?worker_profile=ornith%3A25%21')
})

test('client ready returns the returned tasks array', async () => {
  const fetcher = async () => fakeResponse({ tasks: [{ id: 'a' }, { id: 'b' }] })
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator/')
  assert.deepEqual(await client.ready({}), [{ id: 'a' }, { id: 'b' }])
})

test('client ready returns an empty array when the endpoint sends empty tasks', async () => {
  const calls = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    return fakeResponse({ tasks: [] })
  }
  const client = new TaskOrchestratorClient(fetcher, '/api/task-orchestrator/')
  assert.deepEqual(await client.ready(), [])
  assert.equal(calls[0].url, '/api/task-orchestrator/dispatcher/ready')
})
