function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
}

function validateEstimate(estimate, { context = {}, baseline = {}, config = {}, knowledge = [] } = {}) {
  const errors = []
  const reviewReasons = []
  const keys = ['unitPrice', 'priceRange', 'adjustments', 'evidenceIds', 'buyerAdvice', 'disposalAdvice', 'missingFields', 'summary']
  const exactKeys = (obj, allowed, label) => {
    if (!isObject(obj)) { errors.push(label + '必须是对象'); return false }
    if (Object.keys(obj).some(key => !allowed.includes(key)) || allowed.some(key => !Object.prototype.hasOwnProperty.call(obj, key))) {
      errors.push(label + '字段不符合约定')
    }
    return true
  }
  const text = (value, max, label) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) errors.push(label + '为空或超长')
  }
  const priceKinds = new Set(['sale_deal', 'auction_deal', 'listing', 'community_reference', 'filing_reference'])
  const priceEvidence = (context.evidence || []).filter(row => row && typeof row.id === 'string' && priceKinds.has(row.kind) && positive(row.unitPrice))
  const knownIds = new Set((context.evidence || []).map(row => row && row.id).concat(knowledge.map(row => row && (row.id || row._id))).filter(id => typeof id === 'string'))
  const ids = (value, label) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 30) {
      errors.push(label + '必须包含1至30个证据ID'); return
    }
    value.forEach(id => {
      if (typeof id !== 'string' || !knownIds.has(id)) errors.push(label + '引用了不存在的证据')
    })
    if (new Set(value).size !== value.length) errors.push(label + '存在重复证据ID')
  }
  if (!exactKeys(estimate, keys, '估值结果')) return { valid: false, needsReview: false, errors, reviewReasons, value: null }
  if (!positive(estimate.unitPrice)) errors.push('评估单价必须是有限正数')
  if (exactKeys(estimate.priceRange, ['low', 'high'], '价格区间')) {
    const { low, high } = estimate.priceRange
    if (!positive(low) || !positive(high) || low > estimate.unitPrice || high < estimate.unitPrice || low > high) {
      errors.push('价格区间必须为包含评估单价的有限正数区间')
    }
  }
  ids(estimate.evidenceIds, '估值依据')
  if (!Array.isArray(estimate.evidenceIds) || !priceEvidence.some(row => estimate.evidenceIds.includes(row.id))) {
    errors.push('估值必须引用至少一个房产价格证据')
  }
  if (!Array.isArray(estimate.adjustments) || estimate.adjustments.length > 12) {
    errors.push('修正因素必须是至多12项的数组')
  } else estimate.adjustments.forEach((item, index) => {
    const label = '修正因素' + (index + 1)
    if (!exactKeys(item, ['factor', 'description', 'evidenceIds'], label)) return
    text(item.factor, 80, label + '名称')
    text(item.description, 1000, label + '说明')
    ids(item.evidenceIds, label)
  })
  text(estimate.summary, 1200, '评估摘要')
  text(estimate.buyerAdvice, 2000, '买方建议')
  text(estimate.disposalAdvice, 2000, '处置建议')
  if (!Array.isArray(estimate.missingFields) || estimate.missingFields.length > 20 || estimate.missingFields.some(field => typeof field !== 'string' || !field.trim() || field.length > 100)) {
    errors.push('缺失字段必须是至多20项的字符串数组')
  }
  let totalPriceYuan = null
  const target = context.target || {}
  if (target.type === 'house') {
    if (positive(target.areaSqm) && positive(estimate.unitPrice)) {
      const total = Math.round(target.areaSqm * estimate.unitPrice)
      if (!Number.isSafeInteger(total) || total <= 0) errors.push('评估总价超出有效范围')
      else totalPriceYuan = total
    } else if (!positive(target.areaSqm)) reviewReasons.push('目标房源缺少有效面积，无法计算总价')
  }
  if (config.maxDeviationRatio === undefined || config.maxDeviationRatio === null) {
    reviewReasons.push('价格偏离复核阈值尚未校准，模型候选价需人工复核')
  } else if (!Number.isFinite(config.maxDeviationRatio) || config.maxDeviationRatio < 0) {
    errors.push('价格偏离复核阈值配置无效')
  } else if (positive(baseline.unitPrice) && positive(estimate.unitPrice)) {
    const difference = Math.abs(estimate.unitPrice - baseline.unitPrice)
    const allowed = baseline.unitPrice * config.maxDeviationRatio
    const tolerance = Math.max(1e-8, baseline.unitPrice * Number.EPSILON * 4)
    if (difference > allowed + tolerance) {
      reviewReasons.push('模型候选价相对公式基准的偏离超过配置阈值')
    }
  } else reviewReasons.push('缺少有效公式基准，模型候选价需人工复核')
  const missing = [...new Set([...(context.missingFields || []), ...(Array.isArray(estimate.missingFields) ? estimate.missingFields : [])])]
  const critical = missing.filter(field => typeof field === 'string' && /面积|楼层|户型|房屋性质|占用|交付|areaSqm|floor|rooms|propertyType|occupancy|delivery/i.test(field))
  if (critical.length) reviewReasons.push('关键房源信息待核实：' + critical.join('、'))
  if (errors.length) return { valid: false, needsReview: false, errors: [...new Set(errors)], reviewReasons: [], value: null }
  const value = {
    unitPrice: estimate.unitPrice,
    totalPriceYuan,
    priceRange: { low: estimate.priceRange.low, high: estimate.priceRange.high },
    adjustments: estimate.adjustments.map(item => ({ factor: item.factor.trim(), description: item.description.trim(), evidenceIds: item.evidenceIds.slice() })),
    evidenceIds: estimate.evidenceIds.slice(),
    buyerAdvice: estimate.buyerAdvice.trim(),
    disposalAdvice: estimate.disposalAdvice.trim(),
    missingFields: missing,
    summary: estimate.summary.trim()
  }
  return { valid: true, needsReview: reviewReasons.length > 0, errors: [], reviewReasons: [...new Set(reviewReasons)], value }
}

module.exports = { validateEstimate }
