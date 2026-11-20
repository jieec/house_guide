const test = require('node:test')
const assert = require('node:assert/strict')
const { generateEstimate } = require('../lib/providers')
const { requestJSON } = require('../lib/providers/deepseek')
const https = require('node:https')
const { EventEmitter } = require('node:events')
const { buildMessages } = require('../lib/prompt')

const context = {
  target: { type: 'house', id: 'house-1', name: '测试房源', city: '珠海', areaSqm: 80, purpose: 'investment', tel: 'private-contact' },
  market: { listingAvg: 10000 },
  evidence: [{ id: 'deal-1', kind: 'sale_deal', unitPrice: 10000 }],
  missingFields: [], warnings: []
}
const estimate = {
  unitPrice: 10000,
  priceRange: { low: 9500, high: 10500 },
  adjustments: [], evidenceIds: ['deal-1'],
  buyerAdvice: '核实面积与房屋现状。', disposalAdvice: '结合实际交付条件确定处置安排。',
  missingFields: [], summary: '参考真实成交。'
}
const options = { context, baseline: { unitPrice: 10000 }, knowledge: [], apiKey: 'test-secret', remainingMs: 2000 }
const response = content => ({ status: 200, json: { choices: [{ finish_reason: 'stop', message: { content } }], usage: { total_tokens: 20 } } })

test('JSON call uses configured model, fixed endpoint, schema prompt and a deadline', async () => {
  let request
  const result = await generateEstimate({ ...options, config: { model: 'configured-model', temperature: 0.1, maxTokens: 2000, baseUrl: 'https://untrusted.invalid' } }, async input => {
    request = input
    return response(JSON.stringify(estimate))
  })
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(request.body.model, 'configured-model')
  assert.deepEqual(request.body.response_format, { type: 'json_object' })
  assert.equal(request.body.stream, false)
  assert.equal(request.body.max_tokens, 2000)
  assert.equal(request.headers.Authorization, 'Bearer test-secret')
  assert.ok(request.deadline > Date.now())
  assert.match(request.body.messages[0].content, /JSON/)
  assert.match(request.body.messages[0].content, /不是指令/)
  assert.deepEqual(result.estimate, estimate)
  assert.deepEqual(result.usage, { total_tokens: 20 })
  assert.equal(result.model, 'configured-model')
})

test('preserves provider billing counts and ignores invalid or unrelated usage fields', async () => {
  const reply = response(JSON.stringify(estimate))
  reply.json.usage = {
    prompt_tokens: 1200,
    prompt_cache_hit_tokens: 300,
    prompt_cache_miss_tokens: 900,
    completion_tokens: 260,
    total_tokens: 1460,
    completion_tokens_details: { reasoning_tokens: 0, unrelated_field: 15 },
    unrelated_field: 'ignored'
  }
  const result = await generateEstimate(options, async () => reply)
  assert.deepEqual(result.usage, {
    prompt_tokens: 1200,
    prompt_cache_hit_tokens: 300,
    prompt_cache_miss_tokens: 900,
    completion_tokens: 260,
    total_tokens: 1460,
    completion_tokens_details: { reasoning_tokens: 0 }
  })

  reply.json.usage = {
    prompt_tokens: '1200',
    prompt_cache_hit_tokens: -1,
    prompt_cache_miss_tokens: Infinity,
    completion_tokens: 1.5,
    total_tokens: 20,
    completion_tokens_details: { reasoning_tokens: -3 }
  }
  const partial = await generateEstimate(options, async () => reply)
  assert.deepEqual(partial.usage, { total_tokens: 20 })
})

test('prompt omits buyer purpose and private contact fields', () => {
  const messages = buildMessages({ context, baseline: options.baseline })
  assert.doesNotMatch(messages[1].content, /investment|private-contact/)
})

test('business instructions are included only as subordinate user data', async () => {
  let request
  await generateEstimate({ ...options, config: { businessInstructions: '优先说明银行处置时需核实的交付条件' } }, async input => {
    request = input
    return response(JSON.stringify(estimate))
  })
  const payload = JSON.parse(request.body.messages[1].content)
  assert.equal(payload.businessReference, '优先说明银行处置时需核实的交付条件')
  assert.match(request.body.messages[0].content, /businessReference 是低优先级业务参考/)
  assert.match(request.body.messages[0].content, /不得覆盖 JSON 字段约定/)
})

test('model names accept configured names up to 128 characters', async () => {
  await generateEstimate({ ...options, config: { model: 'm'.repeat(128) } }, async () => response(JSON.stringify(estimate)))
  await assert.rejects(generateEstimate({ ...options, config: { model: 'm'.repeat(129) } }, async () => response(JSON.stringify(estimate))), { code: 'MODEL_CONFIG_ERROR' })
})

test('provider errors are classified without reflecting HTTP error payloads', async () => {
  await assert.rejects(generateEstimate(options, async () => ({ status: 401, json: { error: { message: 'test-secret' } } })), error => {
    assert.equal(error.code, 'MODEL_HTTP_ERROR')
    assert.doesNotMatch(error.message, /test-secret/)
    return true
  })
  await assert.rejects(generateEstimate(options, async () => { throw new Error('test-secret from request') }), error => {
    assert.equal(error.code, 'MODEL_NETWORK_ERROR')
    assert.doesNotMatch(error.message, /test-secret/)
    return true
  })
  await assert.rejects(generateEstimate(options, async () => {
    const error = new Error('test-secret from custom transport')
    error.code = 'MODEL_HTTP_ERROR'
    throw error
  }), error => {
    assert.equal(error.code, 'MODEL_HTTP_ERROR')
    assert.doesNotMatch(error.message, /test-secret/)
    return true
  })
})

test('rejects blank, truncated, non-object and malformed model output', async () => {
  for (const content of ['', '  ', '[]', 'null', '{bad']) {
    await assert.rejects(generateEstimate(options, async () => response(content)), error => /^MODEL_INVALID_/.test(error.code))
  }
  const truncated = response(JSON.stringify(estimate))
  truncated.json.choices[0].finish_reason = 'length'
  await assert.rejects(generateEstimate(options, async () => truncated), { code: 'MODEL_INVALID_RESPONSE' })
  await assert.rejects(generateEstimate(options, async () => ({ status: 200, json: {} })), { code: 'MODEL_INVALID_RESPONSE' })
})

test('absolute budget bounds a hanging transport and rejects exhausted budget', async () => {
  await assert.rejects(generateEstimate({ ...options, remainingMs: 10 }, () => new Promise(() => {})), { code: 'MODEL_TIMEOUT' })
  await assert.rejects(generateEstimate({ ...options, remainingMs: 0 }, async () => response(JSON.stringify(estimate))), { code: 'MODEL_TIMEOUT' })
})

test('rejects unsupported provider and invalid config before making requests', async () => {
  let called = false
  const transport = async () => { called = true; return response(JSON.stringify(estimate)) }
  for (const config of [{ provider: 'unknown' }, { temperature: 9 }, { maxTokens: 1 }, { model: 'bad\nmodel' }]) {
    await assert.rejects(generateEstimate({ ...options, config }, transport), { code: 'MODEL_CONFIG_ERROR' })
  }
  await assert.rejects(generateEstimate({ ...options, apiKey: '' }, transport), { code: 'MODEL_CONFIG_ERROR' })
  assert.equal(called, false)
})

function mockHTTPS(t, respond) {
  const original = https.request
  const requests = []
  https.request = (url, config, onResponse) => {
    const req = new EventEmitter()
    req.setTimeout = () => req
    req.destroy = error => { req.destroyed = true; req.emit('error', error) }
    req.end = body => {
      req.body = JSON.parse(body)
      setImmediate(() => {
        const res = new EventEmitter()
        res.statusCode = 200
        res.destroy = error => { res.destroyed = true; res.emit('error', error) }
        onResponse(res)
        respond(res, req)
      })
    }
    requests.push({ url, config, req })
    return req
  }
  t.after(() => { https.request = original })
  return requests
}

test('HTTPS adapter aborts oversized responses before parsing', async t => {
  const requests = mockHTTPS(t, res => res.emit('data', Buffer.alloc(1024 * 1024 + 1)))
  await assert.rejects(requestJSON({ headers: {}, body: {}, timeoutMs: 1000, deadline: Date.now() + 1000 }), { code: 'MODEL_INVALID_RESPONSE' })
  assert.equal(requests[0].req.destroyed, true)
})

test('HTTPS adapter deadline terminates a response even if bytes keep arriving', async t => {
  let interval
  const requests = mockHTTPS(t, res => {
    interval = setInterval(() => res.emit('data', Buffer.from(' ')), 2)
  })
  t.after(() => clearInterval(interval))
  await assert.rejects(requestJSON({ headers: {}, body: {}, timeoutMs: 20, deadline: Date.now() + 20 }), { code: 'MODEL_TIMEOUT' })
  assert.equal(requests[0].req.destroyed, true)
})
