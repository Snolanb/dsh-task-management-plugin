import { TaskStore } from './store.js'
import { makeRoutes } from './routes.js'
import { createTaskTools } from './tools.js'

export const name = 'task-orchestrator'
export const inject = ['tools']
export const TASK_ORCHESTRATOR_SERVICE = 'taskOrchestrator'

export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  const store = new TaskStore({
    dbPath: config.dbPath,
    defaultLeaseSeconds: config.defaultLeaseSeconds,
    maxAttemptsDefault: config.maxAttemptsDefault,
  })
  const api = Object.freeze({
    version: 1,
    dbPath: store.dbPath,
    store,
    create: store.create.bind(store),
    get: store.get.bind(store),
    list: store.list.bind(store),
    update: store.update.bind(store),
    delete: store.delete.bind(store),
    claim: store.claim.bind(store),
    release: store.release.bind(store),
    renewLease: store.renewLease.bind(store),
    start: store.start.bind(store),
    complete: store.complete.bind(store),
    fail: store.fail.bind(store),
    block: store.block.bind(store),
    unblock: store.unblock.bind(store),
    requestChanges: store.requestChanges.bind(store),
    addDependency: store.addDependency.bind(store),
    removeDependency: store.removeDependency.bind(store),
    addChild: store.addChild.bind(store),
    listChildren: store.listChildren.bind(store),
    listDescendants: store.listDescendants.bind(store),
    readyToRun: store.readyToRun.bind(store),
    blockedByDependencies: store.blockedByDependencies.bind(store),
    events: store.events.bind(store),
    subscribe: store.subscribe.bind(store),
  })
  ctx.provide(TASK_ORCHESTRATOR_SERVICE, api)
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer
  ctx.effect(() => {
    const routeDisposers = webServer === undefined ? [] : makeRoutes(store).map(route => webServer.register(route))
    const toolDisposers = createTaskTools(store).map(tool => ctx.tools.register(tool))
    return () => {
      for (const dispose of routeDisposers) dispose()
      for (const dispose of toolDisposers) dispose()
      store.close()
    }
  }, 'task-orchestrator: store, routes, and tools')
}
