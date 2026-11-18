const DEFAULTS = Object.freeze({
  provider: 'deepseek',
  model: 'deepseek-chat',
  temperature: 0.2,
  maxTokens: 2500,
  requestBudgetMs: 25000,
  maxDeviationRatio: null,
  enabled: true,
  businessInstructions: '',
  configVersion: 'default-v1'
})

function configError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function missingDocument(error) {
  const code = String(error && (error.code || error.errCode) || '')
  const message = String(error && (error.message || error.errMsg) || '')
  return code === 'DATABASE_DOCUMENT_NOT_EXIST' || code === 'DOCUMENT_NOT_FOUND' ||
    /document[^\n]*(?:does not exist|not exist|not found)|文档不存在/i.test(message)
}

function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw configError('CONFIG_INVALID', '估价配置必须是对象')
  }
  const out = {}
  for (const key of Object.keys(DEFAULTS)) {
    out[key] = raw[key] === undefined ? DEFAULTS[key] : raw[key]
  }
  if (out.provider !== 'deepseek') throw configError('CONFIG_INVALID', '当前仅支持 deepseek 供应商')
  if (typeof out.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(out.model)) {
    throw configError('CONFIG_INVALID', 'model 必须是有效的模型标识')
  }
  for (const [key, min, max, integer] of [
    ['temperature', 0, 1, false],
    ['maxTokens', 256, 8000, true],
    ['requestBudgetMs', 1000, 45000, true]
  ]) {
    if (typeof out[key] !== 'number' || !Number.isFinite(out[key]) || out[key] < min || out[key] > max || (integer && !Number.isInteger(out[key]))) {
      throw configError('CONFIG_INVALID', key + ' 超出允许范围')
    }
  }
  if (out.maxDeviationRatio !== null && (typeof out.maxDeviationRatio !== 'number' ||
      !Number.isFinite(out.maxDeviationRatio) || out.maxDeviationRatio < 0 || out.maxDeviationRatio > 1)) {
    throw configError('CONFIG_INVALID', 'maxDeviationRatio 必须为 null 或 0 到 1 之间的数值')
  }
  if (typeof out.enabled !== 'boolean') throw configError('CONFIG_INVALID', 'enabled 必须是布尔值')
  if (typeof out.businessInstructions !== 'string' || out.businessInstructions.length > 4000) {
    throw configError('CONFIG_INVALID', 'businessInstructions 必须是 4000 字以内的文本')
  }
  if (typeof out.configVersion !== 'string' || !out.configVersion.trim() || out.configVersion.length > 64) {
    throw configError('CONFIG_INVALID', 'configVersion 必须是 1 到 64 字的文本')
  }
  // Parameters affecting prices require a defined and tested rule contract first.
  if (raw.rules !== undefined && (!raw.rules || typeof raw.rules !== 'object' || Array.isArray(raw.rules) || Object.keys(raw.rules).length)) {
    throw configError('CONFIG_INVALID', '当前版本尚不支持自定义 rules')
  }
  // Never pass database secrets, custom URLs or legacy prose prompts to a provider.
  out.businessInstructions = out.businessInstructions.trim()
  out.configVersion = out.configVersion.trim()
  out.rules = {}
  return out
}

async function loadConfig(db) {
  let raw
  try {
    const result = await db.collection('ai_config').doc('main').get()
    raw = result && result.data
  } catch (error) {
    if (!missingDocument(error)) throw configError('CONFIG_READ_FAILED', '无法读取估价服务配置')
  }
  return validateConfig(raw === undefined || raw === null ? {} : raw)
}

module.exports = { loadConfig, validateConfig, DEFAULTS }
