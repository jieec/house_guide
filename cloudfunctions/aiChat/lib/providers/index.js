const { buildMessages } = require('../prompt')
const { completeJSON, modelError } = require('./deepseek')

async function generateEstimate({ context, baseline, knowledge = [], config = {}, apiKey, remainingMs }, transport) {
  const provider = config.provider || 'deepseek'
  if (provider !== 'deepseek') throw modelError('MODEL_CONFIG_ERROR', '暂不支持该模型供应商')
  const model = config.model || 'deepseek-chat'
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) {
    throw modelError('MODEL_CONFIG_ERROR', '模型名称配置无效')
  }
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
    throw modelError('MODEL_CONFIG_ERROR', '模型密钥未配置')
  }
  const temperature = config.temperature === undefined ? 0.2 : config.temperature
  const maxTokens = config.maxTokens === undefined ? 2400 : config.maxTokens
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2 || !Number.isSafeInteger(maxTokens) || maxTokens < 128 || maxTokens > 8192) {
    throw modelError('MODEL_CONFIG_ERROR', '模型参数配置无效')
  }
  const budget = remainingMs === undefined ? (config.requestBudgetMs || 20000) : remainingMs
  if (!Number.isFinite(budget) || budget <= 0) throw modelError('MODEL_TIMEOUT', '模型调用时间预算已耗尽')
  const deadline = Date.now() + Math.floor(budget)
  const result = await completeJSON({
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: {
      model,
      messages: buildMessages({ context, baseline, knowledge, config }),
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      stream: false
    },
    timeoutMs: Math.floor(budget),
    deadline
  }, transport)
  return { ...result, model, provider }
}

module.exports = { generateEstimate }
