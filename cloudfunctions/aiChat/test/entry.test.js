const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function structuredEntry({ owner = 'trusted-owner', serviceFactory, row = null } = {}) {
  const module = { exports: {} }
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: row }) }) }) }
  const cloud = { DYNAMIC_CURRENT_ENV: 'dynamic', init() {}, database: () => db, getWXContext: () => ({ OPENID: owner }) }
  const dependencies = {
    'wx-server-sdk': cloud,
    './legacy': () => async event => ({ ok: true, legacyEvent: event }),
    './lib/service': { createValuationService: serviceFactory || require('../lib/service').createValuationService }
  }
  // Keep real service validation and the entry's copied objects in one realm.
  const load = vm.runInThisContext('(function(require, module, exports) {\n' + fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8') + '\n})')
  load(name => {
    assert.ok(Object.prototype.hasOwnProperty.call(dependencies, name), 'unexpected dependency')
    return dependencies[name]
  }, module, module.exports)
  return module.exports.main
}

test('entry retains legacy request/response routing and dispatches explicit valuation actions', async () => {
  const calls = []
  const module = { exports: {} }
  const db = {}
  const cloud = { DYNAMIC_CURRENT_ENV: 'dynamic', init() {}, database: () => db, getWXContext: () => ({ OPENID: 'trusted-owner' }) }
  const requireStub = name => {
    if (name === 'wx-server-sdk') return cloud
    if (name === './legacy') return receivedDb => {
      assert.equal(receivedDb, db)
      return async event => { calls.push(['legacy', event]); return { ok: true, content: '兼容解读' } }
    }
    if (name === './lib/service') return { createValuationService: options => {
      assert.equal(options.db, db)
      return { handle: async (event, owner) => { calls.push(['new', event, owner]); return { ok: true, report: { status: 'rule_only' } } } }
    } }
    throw new Error('unexpected dependency')
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), { require: requireStub, module, exports: module.exports })
  const legacyRequest = { communityId: 'c1', question: '旧前端请求', context: { evaluation: 20000 } }
  assert.equal((await module.exports.main(legacyRequest)).content, '兼容解读')
  const request = { action: 'createEvaluation', targetType: 'community', communityId: 'c1', requestId: '1' }
  await module.exports.main(request)
  assert.equal(calls[0][0], 'legacy')
  assert.equal(calls[1][0], 'new')
  assert.equal(calls[1][2], 'trusted-owner')
})

test('legacy factory retains the existing missing-key response without a model request', async () => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../legacy.js'), 'utf8'), {
    require: name => { assert.equal(name, 'https'); return {} }, module, exports: module.exports, process: { env: {} }
  })
  const result = await module.exports({})({ communityId: 'c1' })
  assert.equal(result.ok, false)
  assert.equal(result.error, '云函数未配置 DEEPSEEK_KEY 环境变量')
})

test('entry strips platform metadata from both valuation actions without mutating the event', async () => {
  const { normalizeRequest } = require('../lib/service')
  const calls = []
  const main = structuredEntry({ serviceFactory: () => ({ handle: async (event, owner) => {
    calls.push({ event, owner })
    return normalizeRequest(event, 2026)
  } }) })
  for (const request of [
    { action: 'createEvaluation', targetType: 'community', communityId: 'c1', requestId: 'platform-metadata' },
    { action: 'getEvaluation', valuationId: 'v_' + '0'.repeat(30) }
  ]) {
    const userInfo = { openId: 'untrusted-owner', appId: 'platform-app' }
    const tcbContext = { openId: 'untrusted-owner', OPENID: 'untrusted-owner' }
    for (const metadata of [{ userInfo }, { tcbContext }, { userInfo, tcbContext }]) {
      const event = Object.freeze({ ...request, ...metadata })
      const result = await main(event)
      assert.equal(result.action, request.action)
      assert.deepEqual(calls.at(-1), { event: request, owner: 'trusted-owner' })
      for (const key of Object.keys(metadata)) assert.equal(event[key], metadata[key])
    }
  }
  const legacyEvent = { question: '旧请求', userInfo: { openId: 'platform-owner' }, tcbContext: { OPENID: 'platform-owner' } }
  assert.equal((await main(legacyEvent)).legacyEvent, legacyEvent)
})

test('entry authorizes reports only with WXContext, never platform metadata', async () => {
  const valuationId = 'v_' + '1'.repeat(30)
  const row = { _id: valuationId, owner: 'trusted-owner', status: 'rule_only', result: { status: 'rule_only' } }
  const request = { action: 'getEvaluation', valuationId, userInfo: { openId: 'forged-owner', OPENID: 'forged-owner' }, tcbContext: { openId: 'forged-owner', OPENID: 'forged-owner' } }
  assert.equal((await structuredEntry({ row })(request)).report.valuationId, valuationId)
  const forged = { ...request, userInfo: { openId: 'trusted-owner', OPENID: 'trusted-owner' }, tcbContext: { openId: 'trusted-owner', OPENID: 'trusted-owner' } }
  assert.equal((await structuredEntry({ row, owner: 'other-owner' })(forged)).code, 'REPORT_NOT_FOUND')
  assert.equal((await structuredEntry({ row, owner: null })(forged)).code, 'UNAUTHORIZED')
})

test('entry preserves rejection of unknown business fields alongside platform metadata', async () => {
  const main = structuredEntry()
  for (const extra of [{ owner: 'forged-owner' }, { context: { evaluation: 1 } }, { unknown: true }]) {
    const result = await main({ action: 'getEvaluation', valuationId: 'v_' + '0'.repeat(30), userInfo: { openId: 'platform-owner' }, tcbContext: { OPENID: 'platform-owner' }, ...extra })
    assert.equal(result.code, 'INVALID_REQUEST')
    assert.deepEqual(Object.keys(result).sort(), ['code', 'error', 'ok'])
  }
})
