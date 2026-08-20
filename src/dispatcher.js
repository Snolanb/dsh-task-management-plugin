import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { preflightWorker as runPreflight } from './worker-preflight.js'

const DEFAULT_OUTPUT_LIMIT = 16 * 1024

function clip(value, limit = DEFAULT_OUTPUT_LIMIT) {
  const text = value === undefined || value === null ? '' : String(value)
  return text.length <= limit ? text : text.slice(0, limit) + '\n[output clipped]'
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

export class WorkerDispatchError extends Error {
  constructor(message, code = 'WORKER_DISPATCH_FAILED', details = {}) {
    super(message)
    this.name = 'WorkerDispatchError'
    this.code = code
    this.details = details
  }
}

export function buildTaskPrompt(task, spec, runId) {
  const criteria = Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0
    ? task.acceptance_criteria.map((item, index) => (index + 1) + '. ' + item).join('\n')
    : '(none supplied)'
  return [
    'You are worker ' + spec.name + ' for dispatch run ' + runId + '.',
    'Work only on task ' + task.id + ' in the pinned workspace below.',
    '',
    'Workspace: ' + (task.workspace ?? '(missing)'),
    'Title: ' + task.title,
    'Description:',
    task.description || '(none supplied)',
    '',
    'Acceptance criteria:',
    criteria,
    '',
    'Restrictions:',
    '- Do not modify unrelated files or tasks.',
    '- Do not create GitHub issues or pull requests unless the task explicitly requests it.',
    '- Run the required tests before reporting completion.',
    '- Report blockers instead of hiding them in prose.',
  ].join('\n')
}

function appendOutput(state, key, chunk) {
  if (state[key].length >= state.limit) return
  state[key] += String(chunk)
  if (state[key].length > state.limit) state[key] = state[key].slice(0, state.limit)
}

function processHandle(child, outputLimit) {
  const state = { stdout: '', stderr: '', limit: outputLimit }
  child.stdout?.on('data', chunk => appendOutput(state, 'stdout', chunk))
  child.stderr?.on('data', chunk => appendOutput(state, 'stderr', chunk))
  let exited = false
  let exitCode = null
  let signal = null
  const wait = new Promise(resolve => {
    child.once('error', error => {
      if (exited) return
      exited = true
      resolve({ exitCode: null, signal: null, stdout: clip(state.stdout, outputLimit), stderr: clip(errorText(error) + (state.stderr ? '\n' + state.stderr : ''), outputLimit), error: errorText(error) })
    })
    child.once('close', (code, closedSignal) => {
      if (exited) return
      exited = true
      exitCode = code
      signal = closedSignal
      resolve({ exitCode, signal, stdout: clip(state.stdout, outputLimit), stderr: clip(state.stderr, outputLimit) })
    })
  })
  return {
    pid: child.pid ?? null,
    wait: () => wait,
    async terminate(signalName = 'SIGTERM') {
      if (exited || child.killed) return false
      return Boolean(child.kill(signalName))
    },
  }
}

export function createHeadlessProcessLauncher({ spawnImpl = nodeSpawn, env = process.env, outputLimit = DEFAULT_OUTPUT_LIMIT } = {}) {
  return {
    async launch({ task, spec, runId }) {
      if (spec.mode !== 'headless-profile') throw new WorkerDispatchError('worker spec does not support the headless process launcher', 'UNSUPPORTED_WORKER_MODE', { mode: spec.mode })
      const prompt = buildTaskPrompt(task, spec, runId)
      const child = spawnImpl(spec.command, ['--profile', spec.profile, prompt], {
        cwd: task.workspace,
        env: { ...env, DSH_TASK_ID: task.id, DSH_DISPATCH_RUN_ID: runId },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      })
      return processHandle(child, outputLimit)
    },
  }
}

function runIdFor(profile, idFactory) {
  return profile + ':' + idFactory()
}

export class WorkerDispatcher {
  constructor({
    store,
    registry,
    launcher = createHeadlessProcessLauncher(),
    preflight,
    preflightOptions = {},
    actor = 'task-dispatcher',
    idFactory = randomUUID,
    clock = () => Date.now(),
    outputLimit = DEFAULT_OUTPUT_LIMIT,
  } = {}) {
    if (!store || typeof store.list !== 'function') throw new TypeError('a task store is required')
    if (!registry || typeof registry.resolve !== 'function') throw new TypeError('a WorkerSpecRegistry is required')
    if (!launcher || typeof launcher.launch !== 'function') throw new TypeError('a worker launcher is required')
    this.store = store
    this.registry = registry
    this.launcher = launcher
    this.preflight = preflight ?? ((request, options) => runPreflight(registry, request, options))
    this.preflightOptions = { ...preflightOptions }
    this.actor = actor
    this.idFactory = idFactory
    this.clock = clock
    this.outputLimit = outputLimit
  }

  async dispatchOnce({ workerProfile, limit = 1 } = {}) {
    if (typeof workerProfile !== 'string' || workerProfile.trim() === '') throw new TypeError('workerProfile is required')
    const tasks = this.store.list({ ready_to_run: true, worker_profile: workerProfile, limit })
    for (const task of tasks) {
      const result = await this.dispatchTask(task)
      if (result.reason === 'claim_race') continue
      return result
    }
    return { dispatched: false, reason: 'no_ready_task', worker_profile: workerProfile }
  }

  async dispatchTask(task) {
    const workerProfile = task.worker_profile
    const preflight = await this.preflight({
      worker_profile: workerProfile,
      worker_model: task.worker_model,
      workspace: task.workspace,
    }, this.preflightOptions)
    if (!preflight.ok) return { dispatched: false, reason: 'preflight_failed', task, preflight }
    const spec = preflight.spec ?? this.registry.resolve(workerProfile, task.worker_model)
    const runId = runIdFor(spec.name, this.idFactory)
    const worker = runId
    const claimed = this.store.claim(task.id, worker, { lease_seconds: spec.leaseSeconds, actor: this.actor })
    if (!claimed.claimed) return { dispatched: false, reason: 'claim_race', task: claimed.task, claim: claimed }

    let handle
    try {
      handle = await this.launcher.launch({ task, spec, selection: spec.model, runId, worker })
      this.store.start(task.id, worker, { actor: this.actor })
    } catch (error) {
      await handle?.terminate?.()
      try { this.store.release(task.id, worker, { actor: this.actor }) } catch {}
      return { dispatched: false, reason: 'launch_failed', task: this.store.get(task.id), error: errorText(error), run_id: runId }
    }

    return await this.monitor(task, spec, handle, { runId, worker })
  }

  async monitor(task, spec, handle, { runId, worker }) {
    let leaseLost = false
    let renewing = false
    const renew = async () => {
      if (renewing || leaseLost) return
      renewing = true
      try {
        const result = this.store.renewLease(task.id, worker, { lease_seconds: spec.leaseSeconds, actor: this.actor })
        if (!result.renewed) {
          leaseLost = true
          await handle.terminate?.()
        }
      } catch {
        leaseLost = true
        await handle.terminate?.()
      } finally {
        renewing = false
      }
    }
    const intervalMs = Math.max(1000, Math.floor(spec.leaseSeconds * 1000 / 3))
    const renewTimer = setInterval(() => { renew() }, intervalMs)
    renewTimer.unref?.()
    let timeoutTimer
    let timedOut = false
    const wait = Promise.resolve().then(() => handle.wait()).catch(error => ({ exitCode: null, signal: null, stdout: '', stderr: errorText(error), error: errorText(error) }))
    const timeout = new Promise(resolve => {
      timeoutTimer = setTimeout(async () => {
        timedOut = true
        await handle.terminate?.()
        resolve({ timeout: true, exitCode: null, signal: 'SIGTERM', stdout: '', stderr: 'worker timed out' })
      }, spec.timeoutMs)
      timeoutTimer.unref?.()
    })
    const outcome = await Promise.race([wait, timeout])
    clearInterval(renewTimer)
    clearTimeout(timeoutTimer)
    if (leaseLost) return { dispatched: true, status: 'lease_lost', task: this.store.get(task.id), run_id: runId, worker }

    const stdout = clip(outcome.stdout, this.outputLimit)
    const stderr = clip(outcome.stderr, this.outputLimit)
    const summary = timedOut
      ? 'worker timed out\n' + stderr
      : outcome.exitCode === 0
        ? stdout || 'worker completed without a final response'
        : stderr || stdout || outcome.error || 'worker exited with code ' + outcome.exitCode
    const result = {
      result_summary: summary,
      files_changed: [],
      tests_run: [],
      remaining_blockers: timedOut ? ['worker timeout'] : outcome.exitCode === 0 ? [] : ['worker exited unsuccessfully'],
    }
    if (timedOut || outcome.exitCode !== 0 || outcome.error) {
      const failed = this.store.fail(task.id, result, { worker, actor: this.actor })
      return { dispatched: true, status: 'failed', task: failed, run_id: runId, worker, exit_code: outcome.exitCode, stdout, stderr }
    }
    const completed = this.store.complete(task.id, result, { worker, actor: this.actor })
    return { dispatched: true, status: 'in_review', task: completed, run_id: runId, worker, exit_code: outcome.exitCode, stdout, stderr }
  }
}
