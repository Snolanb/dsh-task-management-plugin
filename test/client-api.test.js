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
