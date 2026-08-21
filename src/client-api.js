export const TASK_API_PREFIX = '/api/task-orchestrator'

export const BOARD_STATUSES = Object.freeze([
  'backlog', 'planning', 'ready', 'claimed', 'running', 'in_review',
  'changes_requested', 'blocked', 'failed', 'done', 'cancelled',
])

async function responseJson(response) {
  let body
  try {
    body = await response.json()
  } catch {
    body = { error: 'task orchestrator returned invalid JSON' }
  }
  if (!response.ok) {
    const error = new Error(body?.error ?? 'task orchestrator request failed: ' + response.status)
    error.status = response.status
    error.code = body?.code
    throw error
  }
  return body
}

function queryString(options = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) params.set(key, value.join(','))
    else params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded === '' ? '' : '?' + encoded
}

export class TaskOrchestratorClient {
  constructor(fetcher = globalThis.fetch?.bind(globalThis), prefix = TASK_API_PREFIX) {
    if (typeof fetcher !== 'function') throw new Error('fetch is unavailable')
    this.fetcher = fetcher
    this.prefix = prefix.replace(/\/+$/, '')
  }

  async request(path, init = {}) {
    const response = await this.fetcher(this.prefix + path, {
      cache: 'no-store',
      ...init,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    })
    return await responseJson(response)
  }

  async list(options = {}) {
    const query = { ...options }
    if (query.statuses !== undefined && query.status === undefined) { query.status = query.statuses; delete query.statuses }
    return (await this.request('/tasks' + queryString(query))).tasks ?? []
  }

  async ready(options = {}) {
    const query = { ...options }
    if (query.statuses !== undefined && query.status === undefined) { query.status = query.statuses; delete query.statuses }
    return (await this.request('/dispatcher/ready' + queryString(query))).tasks ?? []
  }

  async get(id) {
    return (await this.request('/tasks/' + encodeURIComponent(id))).task
  }

  async create(task) {
    return (await this.request('/tasks', { method: 'POST', body: JSON.stringify(task), headers: { 'content-type': 'application/json' } })).task
  }

  async update(id, patch) {
    return (await this.request('/tasks/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch), headers: { 'content-type': 'application/json' } })).task
  }

  async delete(id, actor) {
    const init = { method: 'DELETE' }
    if (actor !== undefined && actor !== null && actor !== '') init.body = JSON.stringify({ actor })
    return (await this.request('/tasks/' + encodeURIComponent(id), init))
  }

  async action(id, action, payload = {}) {
    const result = await this.request('/tasks/' + encodeURIComponent(id) + '/' + action, {
      method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
    })
    return result.task ?? result
  }

  async claim(id, worker, leaseSeconds) { return await this.action(id, 'claim', { worker, ...(leaseSeconds === undefined ? {} : { lease_seconds: leaseSeconds }) }) }
  async release(id, worker) { return await this.action(id, 'release', { worker }) }
  async renewLease(id, worker, leaseSeconds) { return await this.action(id, 'renew-lease', { worker, ...(leaseSeconds === undefined ? {} : { lease_seconds: leaseSeconds }) }) }
  async start(id, worker) { return await this.action(id, 'start', { worker }) }
  async complete(id, worker, result = {}) { return await this.action(id, 'complete', { worker, ...result }) }
  async fail(id, worker, result = {}) { return await this.action(id, 'fail', { worker, ...result }) }
  async block(id, reason, worker) { return await this.action(id, 'block', { reason, ...(worker === undefined ? {} : { worker }) }) }
  async unblock(id) { return await this.action(id, 'unblock') }
  async requestChanges(id, reason) { return await this.action(id, 'request-changes', { reason }) }

  async children(id, descendants = false) {
    return (await this.request('/tasks/' + encodeURIComponent(id) + '/children' + queryString({ descendants: descendants ? 'true' : undefined }))).tasks ?? []
  }

  async events(id, limit = 100) {
    return (await this.request('/tasks/' + encodeURIComponent(id) + '/events' + queryString({ limit }))).events ?? []
  }

  async addDependency(id, dependsOn) {
    return await this.request('/tasks/' + encodeURIComponent(id) + '/dependencies', {
      method: 'POST', body: JSON.stringify({ depends_on_task_id: dependsOn }), headers: { 'content-type': 'application/json' },
    })
  }

  async removeDependency(id, dependsOn) {
    return await this.request('/tasks/' + encodeURIComponent(id) + '/dependencies' + queryString({ depends_on_task_id: dependsOn }), { method: 'DELETE' })
  }
}

export function createTaskOrchestratorClient(fetcher, prefix) {
  return new TaskOrchestratorClient(fetcher, prefix)
}
