const https = require('https')

const API_URL = 'https://api.deepseek.com/chat/completions'
const MAX_RESPONSE_BYTES = 1024 * 1024
const ERROR_MESSAGES = {
  MODEL_TIMEOUT: '模型调用超时',
  MODEL_INVALID_RESPONSE: '模型响应格式错误或未完整结束',
  MODEL_INVALID_JSON: '模型输出不是有效 JSON 对象',
  MODEL_HTTP_ERROR: '模型服务返回错误',
  MODEL_NETWORK_ERROR: '模型连接失败'
}

function modelError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requestJSON({ headers, body, timeoutMs, deadline }) {
  return new Promise((resolve, reject) => {
    let done = false
    let timer
    let req
    const finish = (error, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timeout = () => {
      const error = modelError('MODEL_TIMEOUT', '模型调用超时')
      finish(error)
      if (req) req.destroy(error)
    }
    const remaining = Math.min(timeoutMs, deadline - Date.now())
    if (remaining <= 0) return timeout()
    const encoded = JSON.stringify(body)
    try {
      // The destination is fixed by this adapter, never supplied by a caller or
      // database configuration. The same deadline bounds a trickling response.
      req = https.request(API_URL, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(encoded) }
      }, res => {
        const chunks = []
        let size = 0
        res.on('data', chunk => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            const error = modelError('MODEL_INVALID_RESPONSE', '模型响应过大')
            finish(error)
            res.destroy(error)
            req.destroy(error)
          } else if (!done) chunks.push(chunk)
        })
        res.on('error', () => finish(modelError('MODEL_NETWORK_ERROR', '模型响应读取失败')))
        res.on('aborted', () => finish(modelError('MODEL_NETWORK_ERROR', '模型响应被中断')))
        res.on('end', () => {
          if (done) return
          if (Date.now() >= deadline) return timeout()
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return finish(modelError('MODEL_HTTP_ERROR', '模型服务返回错误'))
          }
          let json
          try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (_) {
            return finish(modelError('MODEL_INVALID_RESPONSE', '模型响应格式错误'))
          }
          finish(null, { status: res.statusCode, json })
        })
      })
      req.on('error', error => finish(error.code === 'MODEL_TIMEOUT'
        ? error : modelError('MODEL_NETWORK_ERROR', '模型连接失败')))
      timer = setTimeout(timeout, remaining)
      req.setTimeout(remaining, timeout)
      req.end(encoded)
    } catch (_) {
      finish(modelError('MODEL_NETWORK_ERROR', '模型连接失败'))
    }
  })
}

async function completeJSON(options, transport = requestJSON) {
  let timer
  const timeoutError = () => modelError('MODEL_TIMEOUT', '模型调用超时')
  const remaining = Math.min(options.timeoutMs, options.deadline - Date.now())
  if (remaining <= 0) throw timeoutError()
  try {
    // Also bounds injected/custom transports, not just the default HTTPS path.
    const result = await Promise.race([
      Promise.resolve().then(() => transport({ ...options, url: API_URL })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), remaining) })
    ])
    if (Date.now() >= options.deadline) throw timeoutError()
    if (!result || !Number.isInteger(result.status)) {
      throw modelError('MODEL_INVALID_RESPONSE', '模型响应格式错误')
    }
    if (result.status < 200 || result.status >= 300) {
      throw modelError('MODEL_HTTP_ERROR', '模型服务返回错误')
    }
    const json = result.json
    const choice = json && Array.isArray(json.choices) && json.choices[0]
    if (!choice || choice.finish_reason !== 'stop') {
      throw modelError('MODEL_INVALID_RESPONSE', '模型输出未完整结束')
    }
    const content = choice.message && choice.message.content
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > MAX_RESPONSE_BYTES) {
      throw modelError('MODEL_INVALID_RESPONSE', '模型输出为空或格式错误')
    }
    let estimate
    try { estimate = JSON.parse(content) } catch (_) {
      throw modelError('MODEL_INVALID_JSON', '模型输出不是有效 JSON')
    }
    if (!estimate || Array.isArray(estimate) || typeof estimate !== 'object') {
      throw modelError('MODEL_INVALID_JSON', '模型输出不是 JSON 对象')
    }
    const usage = {}
    for (const key of ['prompt_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens', 'completion_tokens', 'total_tokens']) {
      if (json.usage && Number.isSafeInteger(json.usage[key]) && json.usage[key] >= 0) usage[key] = json.usage[key]
    }
    const details = json.usage && json.usage.completion_tokens_details
    if (details && Number.isSafeInteger(details.reasoning_tokens) && details.reasoning_tokens >= 0) {
      usage.completion_tokens_details = { reasoning_tokens: details.reasoning_tokens }
    }
    return { estimate, usage }
  } catch (error) {
    if (error && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, error.code)) {
      throw modelError(error.code, ERROR_MESSAGES[error.code])
    }
    // A transport may throw an error with request headers or provider bodies.
    // Discard those messages rather than returning secrets to the client.
    throw modelError('MODEL_NETWORK_ERROR', '模型连接失败')
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { API_URL, completeJSON, requestJSON, modelError }
