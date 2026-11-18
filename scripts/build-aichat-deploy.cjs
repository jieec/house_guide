const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire, builtinModules } = require('node:module')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const sourceDir = path.join(root, 'cloudfunctions/aiChat')
const entry = path.join(sourceDir, 'index.js')
const outputDir = path.join(root, 'tmp/deploy/aiChat')

function loadEntry(code, filename, state) {
  const module = { exports: {} }
  const localRequire = createRequire(entry)
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'build-verification', init() {},
    getWXContext: () => ({ OPENID: state.owner }),
    database: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ data: state.row }) }) }) })
  }
  const load = vm.runInThisContext('(function(require, module, exports) {\n' + code + '\n})', { filename })
  load(name => name === 'wx-server-sdk' ? cloud : localRequire(name), module, module.exports)
  return module.exports.main
}

async function verifyBundle(sourceCode, bundleCode) {
  const state = { owner: 'build-verification-owner', row: null }
  const original = loadEntry(sourceCode, entry, state)
  const bundled = loadEntry(bundleCode, path.join(outputDir, 'index.js'), state)
  const valuationId = 'v_' + '0'.repeat(30)
  const request = { action: 'getEvaluation', valuationId, userInfo: { openId: 'untrusted-owner' } }
  for (const [input, expectedCode] of [
    [request, 'REPORT_NOT_FOUND'],
    [{ ...request, owner: 'untrusted-owner' }, 'INVALID_REQUEST'],
    [{ action: 'createEvaluation', targetType: 'house', requestId: 'build-only', userInfo: {} }, 'INVALID_REQUEST']
  ]) {
    const actual = await bundled(input)
    assert.deepEqual(actual, await original(input))
    assert.equal(actual.code, expectedCode)
  }
  state.row = { _id: valuationId, owner: state.owner, status: 'rule_only', result: { schemaVersion: '1.0', status: 'rule_only' } }
  assert.deepEqual(await bundled(request), await original(request))
  assert.equal((await bundled(request)).report.valuationId, valuationId)
  state.owner = null
  assert.deepEqual(await bundled(request), await original(request))
  assert.equal((await bundled(request)).code, 'UNAUTHORIZED')
}

async function main() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry], outfile: path.join(outputDir, 'index.js'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node16.13',
    external: ['wx-server-sdk'], write: false, metafile: true,
    sourcemap: false, legalComments: 'none'
  })
  assert.equal(result.outputFiles.length, 1)
  const bundleCode = result.outputFiles[0].text
  // The deployment contains one script and production dependencies only. Never
  // read environment/configuration files or replace process.env during bundling.
  const allowed = new Set(['wx-server-sdk', ...builtinModules])
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      assert.ok(dependency.external && allowed.has(dependency.path), 'Unexpected deployment dependency: ' + dependency.path)
    }
  }
  new vm.Script(bundleCode, { filename: 'aiChat/index.js' })
  await verifyBundle(await fs.readFile(entry, 'utf8'), bundleCode)
  const sourcePackage = JSON.parse(await fs.readFile(path.join(sourceDir, 'package.json'), 'utf8'))
  const productionPackage = {
    name: sourcePackage.name, version: sourcePackage.version,
    description: sourcePackage.description, main: 'index.js',
    dependencies: sourcePackage.dependencies || {}
  }
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, 'index.js'), bundleCode)
  await fs.writeFile(path.join(outputDir, 'package.json'), JSON.stringify(productionPackage, null, 2) + '\n')
  const files = await fs.readdir(outputDir, { withFileTypes: true })
  assert.ok(files.every(file => file.isFile()), 'Deployment directory must contain no subdirectories')
  assert.deepEqual(files.map(file => file.name).sort(), ['index.js', 'package.json'])
  console.log('Built and verified aiChat for Node.js 16.13: ' + outputDir)
  console.log('Files: index.js, package.json; wx-server-sdk remains external. No deployment performed.')
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
