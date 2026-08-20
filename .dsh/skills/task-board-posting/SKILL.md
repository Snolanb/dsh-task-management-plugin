---
name: task-board-posting
description: Create, inspect, and advance tasks in the local DSH task board through the authoritative task-orchestrator service.
whenToUse: Use when a user asks to add, find, update, dispatch, review, or complete work on the standalone DSH task board.
metadata:
  scope: project
  authority: host-task-orchestrator
---

# Task Board Posting

Use the standalone task board as a durable work ledger. The board UI is a view over the Host-owned SQLite task-orchestrator service. Do not edit its DOM, browser state, or SQLite database directly.

## Where the board is

In DSH Web, open the **Tasks** entry in the left sidebar. Refresh the page after a client bundle change. The board is separate from the managed kanban plugin.

Agents should normally use the Host tools below rather than clicking the UI:

- task_create creates a task.
- task_list and task_get inspect tasks.
- task_update edits task metadata or validated fields.
- task_claim, task_start, task_complete, and task_fail own the worker lifecycle.
- task_release and task_renew_lease manage a worker lease.
- task_add_dependency, task_remove_dependency, task_add_child, and task_list_children manage decomposition.
- task_request_changes, task_block, and task_unblock manage review and blocking.
- task_events provides the audit trail.

## Create a task

1. Interpret the user request. Do not invent real repository, workspace, worker, reviewer, or GitHub values unless the user supplied them.
2. Check for an obvious duplicate with task_list when the request could already exist.
3. Call task_create with a clear imperative title and useful structured fields. A typical creation is:

~~~json
{
  "title": "Write the release-note draft",
  "description": "Summarize the user-visible changes for the next release.",
  "status": "backlog",
  "priority": "medium",
  "task_type": "documentation",
  "acceptance_criteria": [
    "Cover the three shipped features",
    "Mention the verification command"
  ],
  "actor": "agent:<agent-name>"
}
~~~

4. Keep fictional or demo tasks clearly labeled in the title or metadata, for example metadata with demo: true.
5. Verify the returned task ID with task_get or task_list and report the ID, title, and status. Leave the task in the board unless the user explicitly asks for cleanup.

The normal initial status is backlog. Use ready only when the task is genuinely prepared for dispatch. Set workspace, repo, branch, worker and reviewer profiles, GitHub linkage, and attempt limits only when known.

## Advance work safely

The usual lifecycle is:

backlog -> planning -> ready -> claimed -> running -> in_review -> done

For a worker-owned task:

1. Check task_ready_to_run.
2. Claim it with a stable worker identity using task_claim and a suitable lease.
3. Start it with task_start.
4. Renew the lease before it expires if work continues.
5. Finish with task_complete and structured result_summary, files_changed, and tests_run; or use task_fail with concrete blockers.
6. Release the claim only when work is being handed back. Never mutate a claimed or running task with a different worker identity or after its lease expires.

Review changes use in_review -> changes_requested -> ready. Use task_request_changes with a specific reason rather than silently editing review state. Keep dependency blocking separate from explicit blocked status.

## Dependencies and decomposition

Use task_add_dependency with task_id and depends_on_task_id for prerequisites. Check readiness after adding dependencies; failed or cancelled prerequisites still block until their state or the edge changes. The service rejects dependency cycles.

Use task_add_child or a child task with parent_id for subtasks. Use task_list_children or task_list_descendants to inspect the hierarchy. Do not duplicate the same work in both a parent and a child without explaining the split.

## HTTP fallback

If Host tools are unavailable but local HTTP is explicitly allowed, the loopback API is:

- Base: http://127.0.0.1:3080/api/task-orchestrator
- GET /tasks returns { tasks: [...] }.
- POST /tasks creates a task and returns { task: ... }.
- GET /tasks/:id reads one task.
- PATCH /tasks/:id updates task fields.
- Lifecycle routes are under /tasks/:id/claim, /start, /complete, /fail, /release, and /renew-lease.

The API is loopback-only. Prefer the typed Host tools because they preserve validation, ownership, and structured errors. Never expose the API remotely or put secrets in task descriptions or metadata.

## Reporting

After a mutation, report what changed and how to find it in the Tasks sidebar entry. For creation, include at least the task title, ID, status, and any important next action. If creation fails, report the structured error and do not claim that the board was updated.
