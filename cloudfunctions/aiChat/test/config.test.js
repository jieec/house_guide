const test = require('node:test')
const assert = require('node:assert/strict')
const { loadConfig, validateConfig, DEFAULTS } = require('../lib/config')

function database(response, error) {
  return {
    collection(name) {
      assert.equal(name, 'ai_config')
      return { doc(id) { assert.equal(id, 'main'); return { async get() { if (error) throw error; return response } } } }
    }
  }
}

test('missing config gets conservative defaults without legacy prose constraints', async () => {
  const missing = Object.assign(new Error('document with _id main does not exist'), { errCode: -1 })
  assert.deepEqual(await loadConfig(database(null, missing)), { ...DEFAULTS, rules: {} })
  const config = await loadConfig(database({ data: { system_prompt: '两段300字', style_rules: '必须使用既有价格' } }))
  assert.equal(config.businessInstructions, '')
  assert.equal(config.maxDeviationRatio, null)
  assert.equal(config.system_prompt, undefined)
})

test('valid config returns only provider-safe settings and does not trust stored prompt versions', async () => {
  const config = await loadConfig(database({ data: {
    provider: 'deepseek', model: 'deepseek-example', temperature: 0, maxTokens: 4000,
    requestBudgetMs: 20000, maxDeviationRatio: 0.1, enabled: false,
    businessInstructions: '  买卖建议需简明  ', configVersion: 'v2',
    apiKey: 'do-not-return', baseURL: 'https://example.invalid', promptVersion: 'untrusted'
  } }))
  assert.equal(config.temperature, 0)
  assert.equal(config.enabled, false)
  assert.equal(config.businessInstructions, '买卖建议需简明')
  assert.equal(config.apiKey, undefined)
  assert.equal(config.baseURL, undefined)
  assert.equal(config.promptVersion, undefined)
})

test('invalid provider, numeric settings and unsupported rule overrides fail explicitly', () => {
  for (const raw of [
    [], { provider: 'another-provider' }, { model: '' }, { model: '../\nmodel' },
    { temperature: '0.2' }, { temperature: NaN }, { temperature: 1.1 },
    { maxTokens: 12 }, { maxTokens: 256.5 }, { maxTokens: Infinity },
    { requestBudgetMs: 999 }, { requestBudgetMs: 45001 },
    { maxDeviationRatio: -0.1 }, { maxDeviationRatio: '0.1' },
    { enabled: 1 }, { businessInstructions: 'x'.repeat(4001) },
    { configVersion: '' }, { rules: { marketWeight: 0.9 } }, { rules: [] }
  ]) assert.throws(() => validateConfig(raw), error => error.code === 'CONFIG_INVALID')
})

test('permission and network errors are not treated as missing configuration', async () => {
  for (const error of [new Error('permission denied'), new Error('database unavailable')]) {
    await assert.rejects(loadConfig(database(null, error)), value => value.code === 'CONFIG_READ_FAILED')
  }
})
