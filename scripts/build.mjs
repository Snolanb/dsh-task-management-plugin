import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })
cpSync('src', 'lib', { recursive: true })
for (const file of ['lib/index.js', 'lib/store.js', 'lib/routes.js', 'lib/tools.js', 'lib/client-api.js', 'lib/client.js']) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
}
if (!existsSync('lib/index.js')) throw new Error('build did not produce lib/index.js')
console.log('built lib/ task-orchestrator entrypoint and modules')
