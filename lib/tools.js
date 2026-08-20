import { defineTool } from '@deepseek-ai/dsh-tools'

function text(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const arrayOfStrings = { type: 'array', items: { type: 'string' } }
const json = { type: 'json' }

function schema(properties, required = []) {
  const output = {}
  for (const [name, definition] of Object.entries(properties)) {
    output[name] = required.includes(name) ? { ...definition, required: true } : definition
  }
  return output
}

function actorFrom(args, exec) {
  return args.actor ?? exec?.agent?.id ?? exec?.agent?.name
}

function tool(name, description, parameters, execute) {
  return defineTool({
    name,
    description,
    parameters,
    output: { schema: json, render: (_args, value) => text(value) },
    async execute(args, exec) {
      return execute(args, exec)
    },
  })
}

const taskFields = {
  title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' },
  parent_id: { type: 'string' }, workspace: { type: 'string' }, repo: { type: 'string' }, branch: { type: 'string' },
  worker_profile: { type: 'string' }, worker_model: { type: 'string' }, reviewer_profile: { type: 'string' }, reviewer_model: { type: 'string' },
  acceptance_criteria: arrayOfStrings, task_type: { type: 'string' }, attempts: { type: 'integer' }, max_attempts: { type: 'integer' },
  github_repo: { type: 'string' }, github_issue: { type: 'integer' }, result_summary: { type: 'string' }, commit_sha: { type: 'string' },
  files_changed: json, tests_run: json, remaining_blockers: json, metadata: json, actor: { type: 'string' },
}

export function createTaskTools(store) {
  const tools = []
  tools.push(tool('task_create', 'Create a persistent orchestration task. Acceptance criteria are ordered first-class data.', schema({ ...taskFields, blocked_by: arrayOfStrings }, ['title']), (args, exec) => store.create(args, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_get', 'Get one task, including dependencies, readiness, acceptance criteria, and structured result fields.', schema({ id: { type: 'string' } }, ['id']), args => store.get(args.id)))
  tools.push(tool('task_list', 'List tasks. Filter by status, parent_id, worker_profile, readiness, expired claims, or in_review.', schema({ status: { type: 'string' }, statuses: arrayOfStrings, parent_id: { type: 'string' }, worker_profile: { type: 'string' }, claimed_by: { type: 'string' }, ready_to_run: { type: 'boolean' }, blocked_by_dependencies: { type: 'boolean' }, expired_claims: { type: 'boolean' }, in_review: { type: 'boolean' }, limit: { type: 'integer' }, offset: { type: 'integer' } }), args => store.list(args)))
  tools.push(tool('task_update', 'Update task fields or move a task through a validated lifecycle transition.', schema({ id: { type: 'string' }, ...taskFields }, ['id']), (args, exec) => { const { id, actor, ...patch } = args; return store.update(id, patch, { actor: actor ?? actorFrom(args, exec) }) }))
  tools.push(tool('task_delete', 'Delete a task while preserving its append-only deletion event.', schema({ id: { type: 'string' }, actor: { type: 'string' } }, ['id']), (args, exec) => store.delete(args.id, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_claim', 'Atomically claim a ready, dependency-unblocked task with a worker lease.', schema({ id: { type: 'string' }, worker: { type: 'string' }, lease_seconds: { type: 'integer' }, actor: { type: 'string' } }, ['id', 'worker']), (args, exec) => store.claim(args.id, args.worker, { lease_seconds: args.lease_seconds, actor: actorFrom(args, exec) })))
  tools.push(tool('task_release', 'Release a worker lease and return the task to ready.', schema({ id: { type: 'string' }, worker: { type: 'string' }, actor: { type: 'string' } }, ['id', 'worker']), (args, exec) => store.release(args.id, args.worker, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_renew_lease', 'Renew an unexpired worker lease.', schema({ id: { type: 'string' }, worker: { type: 'string' }, lease_seconds: { type: 'integer' }, actor: { type: 'string' } }, ['id', 'worker']), (args, exec) => store.renewLease(args.id, args.worker, { lease_seconds: args.lease_seconds, actor: actorFrom(args, exec) })))
  tools.push(tool('task_start', 'Start a claimed task, incrementing its attempt count.', schema({ id: { type: 'string' }, worker: { type: 'string' }, actor: { type: 'string' } }, ['id', 'worker']), (args, exec) => store.start(args.id, args.worker, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_complete', 'Report structured worker output and move a running task into in_review.', schema({ id: { type: 'string' }, worker: { type: 'string' }, result_summary: { type: 'string' }, commit_sha: { type: 'string' }, files_changed: json, tests_run: json, remaining_blockers: json, actor: { type: 'string' } }, ['id', 'worker']), (args, exec) => { const { id, worker, actor, ...result } = args; return store.complete(id, result, { worker, actor: actor ?? actorFrom(args, exec) }) }))
  tools.push(tool('task_fail', 'Report structured worker failure and move a claimed/running task into failed.', schema({ id: { type: 'string' }, worker: { type: 'string' }, result_summary: { type: 'string' }, files_changed: json, tests_run: json, remaining_blockers: json, actor: { type: 'string' } }, ['id', 'worker']), (args, exec) => { const { id, worker, actor, ...result } = args; return store.fail(id, result, { worker, actor: actor ?? actorFrom(args, exec) }) }))
  tools.push(tool('task_block', 'Explicitly block a task, distinct from dependency blocking. A worker id is required when the task is claimed or running; managers may block unclaimed tasks.', schema({ id: { type: 'string' }, reason: { type: 'string' }, remaining_blockers: json, worker: { type: 'string' }, actor: { type: 'string' } }, ['id']), (args, exec) => store.block(args.id, args.reason, { worker: args.worker, remaining_blockers: args.remaining_blockers, actor: actorFrom(args, exec) })))
  tools.push(tool('task_unblock', 'Clear an explicit blocked status and return a task to ready.', schema({ id: { type: 'string' }, actor: { type: 'string' } }, ['id']), (args, exec) => store.unblock(args.id, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_request_changes', 'Ask for review changes and move an in_review task to changes_requested.', schema({ id: { type: 'string' }, reason: { type: 'string' }, actor: { type: 'string' } }, ['id']), (args, exec) => store.requestChanges(args.id, args.reason, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_add_dependency', 'Add a dependency after checking existence and cycles.', schema({ task_id: { type: 'string' }, depends_on_task_id: { type: 'string' }, actor: { type: 'string' } }, ['task_id', 'depends_on_task_id']), (args, exec) => store.addDependency(args.task_id, args.depends_on_task_id, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_remove_dependency', 'Remove a task dependency.', schema({ task_id: { type: 'string' }, depends_on_task_id: { type: 'string' }, actor: { type: 'string' } }, ['task_id', 'depends_on_task_id']), (args, exec) => store.removeDependency(args.task_id, args.depends_on_task_id, { actor: actorFrom(args, exec) })))
  tools.push(tool('task_add_child', 'Create a child implementation task under a parent task.', schema({ parent_id: { type: 'string' }, ...taskFields, blocked_by: arrayOfStrings }, ['parent_id', 'title']), (args, exec) => { const { parent_id, actor, ...child } = args; return store.addChild(parent_id, child, { actor: actor ?? actorFrom(args, exec) }) }))
  tools.push(tool('task_list_children', 'List direct children or all descendants of a parent task.', schema({ parent_id: { type: 'string' }, descendants: { type: 'boolean' } }, ['parent_id']), args => store.listChildren(args.parent_id, { descendants: args.descendants })))
  tools.push(tool('task_list_descendants', 'List all descendants of a parent task.', schema({ parent_id: { type: 'string' } }, ['parent_id']), args => store.listDescendants(args.parent_id)))
  tools.push(tool('task_ready_to_run', 'Explain whether a task is ready and unblocked for dispatch.', schema({ id: { type: 'string' } }, ['id']), args => store.readyToRun(args.id)))
  tools.push(tool('task_blocked_by_dependencies', 'Explain dependency blocking separately from explicit blocked status.', schema({ id: { type: 'string' } }, ['id']), args => store.blockedByDependencies(args.id)))
  tools.push(tool('task_events', 'Read append-only task event history.', schema({ task_id: { type: 'string' }, limit: { type: 'integer' }, before_id: { type: 'integer' } }, ['task_id']), args => store.events(args.task_id, args)))
  return tools
}
