const demo = require('./valuation-demo.js')
const memoryReports = Object.create(null)
let sequence = 0
function newRequestId() { sequence++; return 'mini-' + Date.now().toString(36) + '-' + sequence.toString(36) + '-' + Math.random().toString(36).slice(2, 8) }
function error(code, message) { return Object.assign(new Error(message), { code }) }
function platform() {
  if (typeof wx === 'undefined' || !wx.cloud) throw error('CLOUD_UNAVAILABLE', '云服务不可用；如需演示，请主动进入本地演示模式')
  return wx
}
function bounded(promise, ms = 35000) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error('CLIENT_TIMEOUT', '请求超时，请使用原报告编号查询或重试原请求')), ms) })]).then(
    value => { clearTimeout(timer); return value }, cause => { clearTimeout(timer); throw cause }
  )
}
function checkReport(report, isDemo) {
  if (!report || typeof report !== 'object' || typeof report.valuationId !== 'string' ||
      !['model_estimate', 'needs_review', 'rule_only', 'insufficient_data', 'processing', 'failed'].includes(report.status)) {
    throw error('INVALID_REPORT', '估价接口返回格式不正确，请确认已部署新版本 aiChat 云函数')
  }
  if (!isDemo && report.isDemo) throw error('INVALID_REPORT_SOURCE', '真实估价接口返回了演示结果，已停止使用')
  if (['processing', 'failed'].includes(report.status)) return JSON.parse(JSON.stringify(report))
  if (!report.target || !['house', 'community'].includes(report.target.type) ||
      (report.effectiveUnitPrice !== null && !(typeof report.effectiveUnitPrice === 'number' && Number.isFinite(report.effectiveUnitPrice) && report.effectiveUnitPrice > 0))) {
    throw error('INVALID_REPORT', '估价目标或价格字段无效')
  }
  return JSON.parse(JSON.stringify(report))
}
async function invoke(data) {
  const api = platform()
  let result
  try { result = (await bounded(api.cloud.callFunction({ name: 'aiChat', data }))).result }
  catch (cause) { throw error(cause.code || 'CLOUD_REQUEST_FAILED', cause.message || cause.errMsg || '云估价请求失败') }
  if (!result || result.ok !== true) throw error(result && result.code || 'EVALUATION_FAILED', result && result.error || '估价接口调用失败')
  return checkReport(result.report, false)
}
async function createEvaluation(request, options = {}) {
  const payload = { ...request, action: 'createEvaluation', requestId: request.requestId || newRequestId() }
  if (options.demo === true) {
    const report = checkReport(demo.demoReport(payload, options.scenario), true)
    memoryReports[report.valuationId] = JSON.parse(JSON.stringify(report))
    return report
  }
  return invoke(payload)
}
async function getEvaluation(valuationId, options = {}) {
  if (options.demo === true) {
    if (!memoryReports[valuationId]) throw error('REPORT_NOT_FOUND', '当前演示会话中没有这份报告，请重新生成')
    return JSON.parse(JSON.stringify(memoryReports[valuationId]))
  }
  if (String(valuationId).startsWith('demo-')) throw error('INVALID_REPORT_SOURCE', '演示报告不能通过真实云接口查询')
  return invoke({ action: 'getEvaluation', valuationId })
}
async function loadHouse(houseId, options = {}) {
  if (options.demo === true) return demo.getDemoHouse(options.scenario)
  if (!houseId) throw error('INVALID_TARGET', '缺少房源编号')
  const result = await bounded(platform().cloud.database().collection('houses').doc(houseId).get())
  if (!result || !result.data) throw error('TARGET_NOT_FOUND', '房源不存在')
  return result.data
}
module.exports = { createEvaluation, getEvaluation, loadHouse, newRequestId, checkReport,
  SCENARIOS: demo.SCENARIOS, getDemoHouse: demo.getDemoHouse, getDemoCommunity: demo.getDemoCommunity, getDemoMarket: demo.getDemoMarket }
