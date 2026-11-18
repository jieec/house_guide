const READY_STATUSES = ['model_estimate', 'needs_review', 'rule_only', 'insufficient_data']
const STATUS_LABELS = { model_estimate: '模型估价已生成', needs_review: '候选结果待复核', rule_only: '公式参考结果', insufficient_data: '数据不足，暂无有效估价', processing: '估价处理中', failed: '评估未完成' }
const FIELD_LABELS = { areaSqm: '真实面积', floor: '楼层', totalFloors: '总楼层', rooms: '户型', orientation: '朝向', decoration: '装修', propertyType: '房屋性质', occupancy: '占用情况', deliveryStatus: '交付条件', saleDeals: '可核查成交实例', marketPriceReference: '市场价格依据' }
const KIND_LABELS = { sale_deal: '二手成交', auction_deal: '法拍成交', listing: '挂牌参考', rent: '租赁参考', community_reference: '小区参考', filing_reference: '备案参考' }
const FALLBACK_LABELS = { MODEL_TIMEOUT: '模型调用超时，当前采用公式参考价。', MODEL_NOT_CONFIGURED: '模型尚未配置，当前采用公式参考价。', MODEL_DISABLED: '模型调用已关闭，当前采用公式参考价。', NO_PRICE_EVIDENCE: '缺少有效价格依据。', MODEL_VALIDATION_FAILED: '模型结果未通过校验，当前采用公式参考价。' }
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0
function formatPrice(n) { return positive(n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '暂无' }
function formatTime(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + '（北京时间）' : ''
}
function canExportValuation(report) { return !!report && READY_STATUSES.includes(report.status) }
function toValuationView(report) {
  if (!report) return null
  const target = report.target || {}, model = report.modelEstimate || {}
  const range = report.priceRange
  return {
    status: report.status, statusLabel: STATUS_LABELS[report.status] || '状态待核实',
    isDemo: report.isDemo === true, demoLabel: report.demoLabel || '演示数据 · 本地模拟响应，非真实模型估价',
    title: target.type === 'house' ? '单套房估价' : '小区参考估价', valuationId: report.valuationId || '',
    effectivePrice: formatPrice(report.effectiveUnitPrice), baselinePrice: formatPrice(report.baselineUnitPrice), candidatePrice: formatPrice(report.modelUnitPrice),
    totalPrice: positive(report.totalPriceYuan) ? (report.totalPriceYuan / 10000).toFixed(2) : '暂无',
    hasTotal: target.type === 'house', hasCandidate: positive(report.modelUnitPrice),
    sourceLabel: report.effectiveSource === 'model' ? '采用模型估价' : report.effectiveSource === 'rule' ? '采用公式参考价' : '未采用价格',
    areaLabel: target.type === 'house' ? positive(target.areaSqm) ? target.areaSqm + ' ㎡' : '真实面积待补充' : '小区参考单价，无单套总价',
    rangeLabel: range && positive(range.low) && positive(range.high) ? formatPrice(range.low) + ' – ' + formatPrice(range.high) + ' 元/㎡' : '',
    candidateRangeLabel: report.status === 'needs_review' && model.priceRange ? formatPrice(model.priceRange.low) + ' – ' + formatPrice(model.priceRange.high) + ' 元/㎡' : '',
    adviceLabel: report.status === 'needs_review' ? '候选分析 · 待复核，尚未采纳' : '评估分析',
    buyerAdvice: report.buyerAdvice || model.buyerAdvice || '', disposalAdvice: report.disposalAdvice || model.disposalAdvice || '',
    summary: report.summary || model.summary || '', reviewReasons: report.reviewReasons || [],
    missingFields: (report.missingFields || []).map(key => FIELD_LABELS[key] || key),
    warnings: report.warnings || [],
    evidence: (report.evidence || []).map(item => ({ ...item, kindLabel: KIND_LABELS[item.kind] || '价格参考', priceLabel: formatPrice(item.unitPrice), unitLabel: item.kind === 'rent' ? '元/㎡/月' : '元/㎡', dateLabel: item.date || '日期待核实', sourceLabel: item.source || '来源待核实' })),
    fallbackLabel: FALLBACK_LABELS[report.fallbackReason] || (report.fallbackReason ? '模型暂不可用，结果来源请以当前标识为准。' : ''),
    generatedAt: report.generatedAt ? formatTime(report.generatedAt) : ''
  }
}
module.exports = { READY_STATUSES, STATUS_LABELS, FIELD_LABELS, KIND_LABELS, FALLBACK_LABELS, formatPrice, canExportValuation, toValuationView }
