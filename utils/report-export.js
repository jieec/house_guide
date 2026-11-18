const pdf = require('./pdf.js')

function value(v) {
  if (v === undefined || v === null || v === '') return '暂无数据'
  if (Array.isArray(v)) return v.length ? v.join('、') : '暂无数据'
  if (typeof v === 'object') return Object.keys(v).map(k => k + '：' + v[k]).join('；') || '暂无数据'
  return String(v)
}

function lineItems(items) {
  return (items || []).filter(Boolean).map(item => ({
    label: item.label || item.name || '项目',
    value: value(item.value !== undefined ? item.value : item),
    note: item.note || '',
    emphasis: !!item.emphasis,
    detail: !!item.detail,
    warning: !!item.warning,
    highlight: !!item.highlight,
    group: item.group || ''
  }))
}

const READY_STATUSES = ['model_estimate', 'needs_review', 'rule_only', 'insufficient_data']
const STATUS_LABELS = { model_estimate: '模型估价已采用', needs_review: '模型候选待复核', rule_only: '公式参考结果', insufficient_data: '数据不足，无法估价' }
const SOURCE_LABELS = { model: '模型估价', rule: '公式基准参考' }
const ATTRIBUTE_LABELS = { floor: '所在楼层', totalFloors: '总楼层', rooms: '户型', orientation: '朝向', decoration: '装修', elevator: '电梯', buildYear: '建成年份', occupancy: '占用情况', deliveryStatus: '交付条件' }
const MISSING_LABELS = { areaSqm: '单套面积', floor: '所在楼层', totalFloors: '总楼层', rooms: '户型', orientation: '朝向', decoration: '装修', propertyType: '房屋性质', occupancy: '占用情况', deliveryStatus: '交付条件', saleDeals: '真实成交样本', marketPriceReference: '市场价格参考' }
const EVIDENCE_LABELS = { sale_deal: '二手房成交', auction_deal: '法拍成交', listing: '挂牌参考', rent: '租赁参考', community_reference: '小区均价参考', filing_reference: '备案价参考' }

function positive(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0 }
function amount(v, unit) { return positive(v) ? String(Math.round(v * 100) / 100) + (unit || '') : '暂无数据' }
function snapshot(v) { return JSON.parse(JSON.stringify(v)) }
function string(v) { return typeof v === 'string' && v.trim() ? v.trim() : '' }
function labels(items) { return (items || []).map(key => MISSING_LABELS[key] || String(key)) }
function displayTime(v) {
  const time = new Date(v)
  return v && Number.isFinite(time.getTime()) ? new Date(time.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') + '（北京时间）' : '未记录'
}

// Structured reports deliberately bypass legacy form storage. Every exported
// number and statement comes from one frozen valuation result, not a prior house.
function collectValuation(d) {
  const r = snapshot(d.valuationReport)
  if (!READY_STATUSES.includes(r.status)) throw new Error('评估尚未完成，暂不能导出')
  const target = r.target || {}, candidate = r.modelEstimate || null
  const house = target.type === 'house', demo = r.isDemo === true || d.demoMode === true
  const statusLabel = STATUS_LABELS[r.status]
  const sourceLabel = SOURCE_LABELS[r.effectiveSource] || '暂无采用价格'
  const missing = labels(r.missingFields)
  const basic = [
    { label: '评估对象', value: house ? '单套房产' : '小区参考' },
    { label: '小区名称', value: target.name || '未提供' },
    { label: '位置', value: [target.city, target.district].filter(Boolean).join(' ') || '未提供' },
    { label: '房产编号', value: target.id || '未提供' },
    { label: '房屋性质', value: target.propertyType || '待核实' },
    { label: house ? '单套面积' : '面积说明', value: house ? amount(target.areaSqm, ' ㎡') : '小区参考估价不计算单套总价', note: target.overrides && target.overrides.areaSqm ? '来源：人工补录' : '' }
  ]
  Object.keys(ATTRIBUTE_LABELS).forEach(key => {
    const v = (target.attributes || {})[key]
    if (v !== undefined && v !== null && v !== '') basic.push({ label: ATTRIBUTE_LABELS[key], value: typeof v === 'boolean' ? (v ? '有' : '无') : String(v), note: target.overrides && target.overrides[key] ? '来源：人工补录' : '' })
  })
  const chart = [
    { key: 'baseline', label: '公式基准价', amount: r.baselineUnitPrice, note: '服务器公式计算的参考价格' },
    { key: 'model', label: r.status === 'needs_review' ? '模型候选价（待复核）' : '模型候选价', amount: r.modelUnitPrice, note: r.status === 'needs_review' ? '候选结果尚未采用，不能替代当前采用价' : '通过结构校验的模型候选价格' },
    { key: 'effective', label: '当前采用价', amount: r.effectiveUnitPrice, note: sourceLabel }
  ].map(item => ({ ...item, amount: positive(item.amount) ? item.amount : null, value: positive(item.amount) ? String(Math.round(item.amount * 100) / 100) : '暂无数据' }))
  const prices = chart.map(item => ({ label: item.label, value: amount(item.amount, ' 元/㎡'), note: item.note, emphasis: item.key === 'effective' }))
  prices.push({ label: '采用总价', value: house ? amount(r.totalPriceYuan, ' 元') : '不适用（小区参考估价）', note: house ? '采用单价 × 评估快照中的单套面积' : '', emphasis: true })
  if (house && r.status === 'needs_review' && candidate) prices.push({ label: '候选总价（待复核）', value: positive(target.areaSqm) ? amount(candidate.totalPriceYuan, ' 元') : '暂无数据', note: '服务器保存的候选总价，尚未采纳', warning: true })
  if (positive(target.listingUnitPrice)) prices.push({ label: '目标挂牌价', value: amount(target.listingUnitPrice, ' 元/㎡'), note: '目标报价只用于对照，不作为独立成交证据' })
  if (r.priceRange) prices.push({ label: '采用参考区间', value: amount(r.priceRange.low) + ' - ' + amount(r.priceRange.high, ' 元/㎡'), note: '参考区间不等于统计置信区间' })
  if (r.status === 'needs_review' && candidate && candidate.priceRange) prices.push({ label: '候选参考区间（待复核）', value: amount(candidate.priceRange.low) + ' - ' + amount(candidate.priceRange.high, ' 元/㎡'), warning: true, note: '仅供复核，未作为当前采用区间' })
  if (r.fallbackReason) prices.push({ label: '回退原因', value: String(r.fallbackReason), warning: true })
  ;(r.reviewReasons || []).forEach(reason => prices.push({ label: '复核事项', value: String(reason), warning: true }))

  const advice = []
  if (r.status === 'model_estimate') {
    advice.push({ label: '估价摘要', value: r.summary || candidate && candidate.summary || '未提供' },
      { label: '买方建议', value: r.buyerAdvice || candidate && candidate.buyerAdvice || '未提供' },
      { label: '卖方及银行处置意见', value: r.disposalAdvice || candidate && candidate.disposalAdvice || '未提供' })
  } else if (r.status === 'needs_review' && candidate) {
    advice.push({ label: '候选意见说明', value: '以下模型候选意见尚待人工复核，未作为已采用结论。', warning: true },
      { label: '候选摘要（待复核）', value: candidate.summary || '未提供' },
      { label: '候选买方建议（待复核）', value: candidate.buyerAdvice || '未提供' },
      { label: '候选处置意见（待复核）', value: candidate.disposalAdvice || '未提供' })
  } else advice.push({ label: '意见状态', value: r.status === 'rule_only' ? '模型意见未采用；当前仅提供公式参考结果。' : '关键数据不足，暂不生成价格与处置结论。', warning: true })
  ;(candidate && candidate.adjustments || []).forEach(item => advice.push({ label: '价格修正 · ' + (item.factor || '因素'), value: String(item.description || ''), note: '引用证据：' + (item.evidenceIds || []).join('、'), detail: true }))

  const evidence = (r.evidence || []).map((item, index) => ({
    label: String(index + 1).padStart(2, '0') + ' ' + (EVIDENCE_LABELS[item.kind] || '市场参考'),
    value: [amount(item.unitPrice, item.kind === 'rent' ? ' 元/㎡/月' : ' 元/㎡'), positive(item.areaSqm) ? amount(item.areaSqm, ' ㎡') : '', item.date || '日期待核实'].filter(Boolean).join('；'),
    note: ['证据编号：' + (item.id || '未提供'), '来源：' + (item.source || '未注明'), item.url ? '链接：' + item.url : ''].filter(Boolean).join('\n'), detail: true
  }))
  if (!evidence.length) evidence.push({ label: '市场证据', value: '当前没有可用的价格证据', warning: true })
  ;(r.knowledgeUsed || []).forEach(item => evidence.push({ label: '知识参考', value: item.title || item.id || '未注明', note: [item.version ? '版本：' + item.version : '', item.sourceUrl || '来源待核实'].filter(Boolean).join('\n'), detail: true }))
  const meta = [
    { label: '报告编号', value: r.valuationId || '未提供' },
    { label: '结果生成时间', value: displayTime(r.generatedAt) },
    { label: '数据模式', value: demo ? '演示数据，仅用于功能验证，不代表真实房产' : '云端评估结果' },
    { label: '估价状态及来源', value: statusLabel + '；' + sourceLabel },
    { label: '模型配置', value: '供应商：' + String((r.versions || {}).provider || '未记录') + '\n模型：' + String((r.versions || {}).model || '未记录') },
    { label: '流程版本', value: ['prompt', 'rule', 'config', 'knowledge'].map(key => ({ prompt: '提示词', rule: '基准规则', config: '配置', knowledge: '知识' }[key]) + '：' + String((r.versions || {})[key] || '未记录')).join('\n') },
    ...missing.map(field => ({ label: '待核实信息', value: field, warning: true })),
    ...(r.warnings || []).map(warning => ({ label: '数据提示', value: String(warning), warning: true }))
  ]
  return {
    valuationId: r.valuationId || '', isDemo: demo,
    demoLabel: demo ? '演示数据 · 仅用于功能验证' : '',
    reportKind: house ? '单套房估价报告' : '小区参考估价报告',
    title: target.name || (house ? '单套房产' : '小区参考'), subtitle: [target.city, target.district, house ? '单套房产估价' : '小区参考估价'].filter(Boolean).join(' · '),
    generatedAt: displayTime(r.generatedAt), updatedAt: r.dataQuality && r.dataQuality.asOfDate || '未记录',
    chart, missing, adviceVisual: null, valuationSnapshot: r,
    valuationSummary: { status: statusLabel, source: sourceLabel, unitPrice: amount(r.effectiveUnitPrice), totalPrice: house ? amount(r.totalPriceYuan, ' 元') : '小区参考，不计算总价' },
    sections: [
      { number: '01', title: '评估对象', items: lineItems(basic) },
      { number: '02', title: '估价结果', items: lineItems(prices) },
      { number: '03', title: '评估与处置意见', items: lineItems(advice) },
      { number: '04', title: '市场证据与知识依据', items: lineItems(evidence) },
      { number: '05', title: '报告信息与待核实事项', items: lineItems(meta) }
    ]
  }
}

function collect(page) {
  const d = page.data || {}
  if (d.valuationReport) return collectValuation(d)
  const savedBasic = wx.getStorageSync('basic') || {}
  const savedAnalysis = wx.getStorageSync('analysis') || {}
  const savedConclusion = wx.getStorageSync('conclusion') || {}
  const savedFinance = wx.getStorageSync('finance') || {}
  const current = { ...savedBasic, ...savedAnalysis, ...savedConclusion, ...savedFinance, ...d }
  const report = d.report || {}
  const selected = d.selectedCommunity || {}
  const basic = report.basic && report.basic.length ? report.basic : Object.keys({ ...savedBasic, ...selected, ...d.form }).map(k => ({ label: k, value: ({ ...savedBasic, ...selected, ...d.form })[k] }))
  const prices = report.prices && report.prices.length ? report.prices : Object.keys(current).map(k => ({ label: k, value: current[k] }))
  const advice = report.advice ? [
    { label: '投资综合评分', value: report.advice.investment && report.advice.investment.totalScore + '分', emphasis: true, group: '投资结论' },
    { label: '投资建议', value: report.advice.investment && report.advice.investment.level, emphasis: true, group: '投资结论' },
    ...(report.advice.investment && report.advice.investment.categories || []).flatMap(category => [
      { label: category.name + '评分', value: category.score + '分（分项占比 ' + category.pct + '%）', emphasis: true, group: '投资维度' },
      { label: '判断标准', value: category.threshold, group: category.name, detail: true },
      ...(category.details || []).map(detail => ({ label: detail.label, value: detail.value, group: category.name, detail: true, highlight: detail.highlight }))
    ]),
    { label: '自住综合评分', value: report.advice.selfuse && report.advice.selfuse.totalScore + '分', emphasis: true, group: '自住结论' },
    { label: '自住建议', value: report.advice.selfuse && report.advice.selfuse.level, emphasis: true, group: '自住结论' },
    ...(report.advice.selfuse && report.advice.selfuse.categories || []).flatMap(category => [
      { label: category.name + '评分', value: category.score + '分（分项占比 ' + category.pct + '%）', emphasis: true, group: '自住维度' },
      { label: '判断标准', value: category.threshold, group: category.name, detail: true },
      ...(category.details || []).map(detail => ({ label: detail.label, value: detail.value, group: category.name, detail: true, highlight: detail.highlight }))
    ])
  ] : Object.keys({ ...savedConclusion, ...d }).map(k => ({ label: k, value: ({ ...savedConclusion, ...d })[k] }))
  const policyItems = (report.policies || []).flatMap(policy => Object.keys(policy).map(key => ({ label: (policy.city || '政策') + ' · ' + key, value: policy[key], detail: true, group: '政策依据' })))
  const toolItems = []
  ;(report.tools || []).forEach(tool => {
    // 工具标题
    toolItems.push({ label: tool.label, value: tool.value || tool.note, group: '工具结论', emphasis: true })
    
    // 展开所有部件明细
    ;(tool.parts || []).forEach(part => {
      toolItems.push({ label: part.name, value: part.value, group: tool.label, detail: true })
    })
    
    // 计算公式
    if (tool.formula) {
      toolItems.push({ label: '计算公式', value: tool.formula, group: tool.label, detail: true, highlight: true })
    }
    
    // 输入参数
    if (tool.inputs && tool.inputs.length) {
      tool.inputs.forEach(input => {
        toolItems.push({ label: '参数 · ' + input.label, value: input.value, group: tool.label, detail: true })
      })
    }
    
    // 风险提示
    if (tool.warning) {
      toolItems.push({ label: '风险提示', value: tool.warning, group: tool.label, warning: true })
    }
  })
  
  // 贷款测算 - 详细展示三种还款方式
  if (d.loanForm && d.loanForm.totalPrice) {
    const form = d.loanForm
    const totalPrice = parseFloat(form.totalPrice) || 0
    const downRate = Math.max(0, Math.min(100, parseFloat(form.downPayment) || 30))
    const years = Math.max(1, parseFloat(form.termYears) || 30)
    const commercialRate = parseFloat(form.commercialRate) || 4.1
    const providentRate = parseFloat(form.providentRate) || 3.1
    
    if (totalPrice > 0) {
      const totalLoan = totalPrice * 10000 * (1 - downRate / 100)
      const downAmount = totalPrice * 10000 * downRate / 100
      
      toolItems.push({ label: '贷款测算详情', value: '三种还款方式对比', group: '工具结论', emphasis: true })
      toolItems.push({ label: '房屋总价', value: totalPrice + '万元', group: '贷款测算', detail: true })
      toolItems.push({ label: '首付比例', value: downRate + '%', group: '贷款测算', detail: true })
      toolItems.push({ label: '首付金额', value: Math.round(downAmount / 10000) + '万元', group: '贷款测算', detail: true, emphasis: true })
      toolItems.push({ label: '贷款总额', value: Math.round(totalLoan / 10000) + '万元', group: '贷款测算', detail: true, emphasis: true })
      toolItems.push({ label: '贷款年限', value: years + '年(' + (years * 12) + '期)', group: '贷款测算', detail: true })
      toolItems.push({ label: '贷款利率', value: commercialRate + '%', group: '贷款测算', detail: true })
      
      // 计算等额本息
      const calcEqualPayment = (principal, rate, years) => {
        const n = years * 12
        const r = rate / 12 / 100
        const monthly = r > 0 ? principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : principal / n
        const total = monthly * n
        return { monthly, total, interest: total - principal }
      }
      
      // 计算等额本金
      const calcEqualPrincipal = (principal, rate, years) => {
        const n = years * 12
        const r = rate / 12 / 100
        const monthlyPrincipal = principal / n
        const first = monthlyPrincipal + principal * r
        const last = monthlyPrincipal + monthlyPrincipal * r
        const total = principal + principal * r * (n + 1) / 2
        return { first, last, total, interest: total - principal }
      }
      
      // 计算先息后本
      const calcInterestFirst = (principal, rate, years) => {
        const n = years * 12
        const r = rate / 12 / 100
        const monthlyInterest = principal * r
        const lastMonth = principal + monthlyInterest
        const total = monthlyInterest * n + principal
        return { monthlyInterest, lastMonth, total, interest: total - principal }
      }
      
      // 方式一：等额本息
      const ep = calcEqualPayment(totalLoan, commercialRate, years)
      toolItems.push({ label: '方式一：等额本息', value: '每月还款固定', group: '贷款测算', emphasis: true })
      toolItems.push({ label: '每月还款', value: Math.round(ep.monthly) + '元', group: '等额本息', detail: true, highlight: true })
      toolItems.push({ label: '还款总额', value: Math.round(ep.total / 10000) + '万元', group: '等额本息', detail: true })
      toolItems.push({ label: '支付利息', value: Math.round(ep.interest / 10000) + '万元', group: '等额本息', detail: true })
      toolItems.push({ label: '计算公式', value: '月供 = 本金 × 月利率 × (1+月利率)^期数 ÷ [(1+月利率)^期数 - 1]', group: '等额本息', detail: true, highlight: true })
      
      // 方式二：等额本金
      const epr = calcEqualPrincipal(totalLoan, commercialRate, years)
      toolItems.push({ label: '方式二：等额本金', value: '本金固定递减', group: '贷款测算', emphasis: true })
      toolItems.push({ label: '首月还款', value: Math.round(epr.first) + '元', group: '等额本金', detail: true, highlight: true })
      toolItems.push({ label: '末月还款', value: Math.round(epr.last) + '元', group: '等额本金', detail: true })
      toolItems.push({ label: '还款总额', value: Math.round(epr.total / 10000) + '万元', group: '等额本金', detail: true })
      toolItems.push({ label: '支付利息', value: Math.round(epr.interest / 10000) + '万元', group: '等额本金', detail: true })
      toolItems.push({ label: '计算公式', value: '月供 = 本金÷期数 + (本金-已还本金) × 月利率', group: '等额本金', detail: true, highlight: true })
      
      // 方式三：先息后本
      const inf = calcInterestFirst(totalLoan, commercialRate, years)
      toolItems.push({ label: '方式三：先息后本', value: '只还利息到期还本', group: '贷款测算', emphasis: true })
      toolItems.push({ label: '每月利息', value: Math.round(inf.monthlyInterest) + '元', group: '先息后本', detail: true, highlight: true })
      toolItems.push({ label: '到期一次性还本', value: Math.round(totalLoan / 10000) + '万元', group: '先息后本', detail: true, emphasis: true })
      toolItems.push({ label: '还款总额', value: Math.round(inf.total / 10000) + '万元', group: '先息后本', detail: true })
      toolItems.push({ label: '支付利息', value: Math.round(inf.interest / 10000) + '万元', group: '先息后本', detail: true })
      toolItems.push({ label: '计算公式', value: '月供 = 本金 × 月利率；末期 = 本金 + 当月利息', group: '先息后本', detail: true, highlight: true })
      
      // 三种方式对比总结
      toolItems.push({ label: '利息对比总结', value: '综合分析', group: '贷款测算', emphasis: true })
      toolItems.push({ label: '等额本息利息', value: Math.round(ep.interest / 10000) + '万元', group: '利息对比', detail: true })
      toolItems.push({ label: '等额本金利息', value: Math.round(epr.interest / 10000) + '万元（最省' + Math.round((ep.interest - epr.interest) / 10000) + '万）', group: '利息对比', detail: true, highlight: true })
      toolItems.push({ label: '先息后本利息', value: Math.round(inf.interest / 10000) + '万元（最高）', group: '利息对比', detail: true, warning: true })
    }
  } else if (d.loanResult && d.loanResult.valid) {
    // 兼容旧版单一结果
    toolItems.push({ label: '贷款测算', value: '详细结果', group: '工具结论', emphasis: true })
    ;(d.loanResult.parts || []).forEach(part => {
      toolItems.push({ label: part.name, value: part.value, group: '贷款测算', detail: true, emphasis: true })
    })
    if (d.loanResult.formula) {
      toolItems.push({ label: '还款公式', value: d.loanResult.formula, group: '贷款测算', detail: true, highlight: true })
    }
  }
  
  if (!toolItems.length) Object.keys(savedFinance).forEach(k => toolItems.push({ label: k, value: savedFinance[k] }))
  return {
    chart: report.prices || [],
    adviceVisual: report.advice || null,
    generatedAt: new Date().toLocaleDateString(),
    title: selected.community || d.communityName || savedBasic.communityName || '房产评估报告',
    subtitle: [selected.city || d.city, selected.district || d.district].filter(Boolean).join(' '),
    updatedAt: d.updatedAt || '',
    missing: report.missing || [],
    summary: {
      investmentScore: report.advice && report.advice.investment ? report.advice.investment.totalScore : '',
      investmentLevel: report.advice && report.advice.investment ? report.advice.investment.level : '暂无结论',
      selfuseScore: report.advice && report.advice.selfuse ? report.advice.selfuse.totalScore : '',
      selfuseLevel: report.advice && report.advice.selfuse ? report.advice.selfuse.level : '暂无结论',
      dataStatus: report.missing && report.missing.length ? '部分数据待核实' : '数据完整'
    },
    sections: [
      { number: '01', title: '基本信息', items: lineItems(basic).concat(lineItems([{ label: '交通配套', value: report.traffic }, { label: '教育配套', value: report.schools }, { label: '周边竞品', value: report.competitors && report.competitors.map(i => i.name + ' ' + i.value) }])) },
      { number: '02', title: '价值分析', items: lineItems(prices).concat(lineItems(report.priceDetails || []).map(item => ({ ...item, detail: true }))) },
      { number: '03', title: '购置建议', items: lineItems(advice).concat(lineItems(policyItems)).concat(report.missing && report.missing.length ? [{ label: '待核实数据', value: report.missing.join('、'), warning: true }] : []) },
      { number: '04', title: '工具使用与测算', items: lineItems(toolItems).concat(d.loanResult && d.loanResult.valid ? lineItems(d.loanResult.parts).map(item => ({ ...item, emphasis: true, group: '贷款测算结果' })) : []) }
    ]
  }
}

// Paint one A4 page at a time; a fixed 2x canvas keeps memory bounded on phones.
const layout = require('./report-layout.js')
function draw(page, data) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select('#pdfCanvas').fields({ node: true, size: true }).exec(async res => {
      const canvas = res && res[0] && res[0].node
      if (!canvas) return reject(new Error('报告画布不可用'))
      const paths = []
      try {
        canvas.width = layout.width * 2
        canvas.height = layout.height * 2
        const ctx = canvas.getContext('2d')
        ctx.scale(2, 2)
        const pages = layout.buildPages(ctx, data)
        for (let i = 0; i < pages.length; i++) {
          wx.showLoading({ title: '生成报告 ' + (i + 1) + '/' + pages.length })
          layout.paintPage(ctx, pages[i])
          await new Promise(ok => canvas.requestAnimationFrame ? canvas.requestAnimationFrame(ok) : setTimeout(ok, 32))
          const path = await new Promise((ok, fail) => wx.canvasToTempFilePath({
            canvas,
            destWidth: layout.width * 2, destHeight: layout.height * 2,
            fileType: 'jpg', quality: 0.95,
            success: r => r.tempFilePath ? ok(r.tempFilePath) : fail(new Error('报告图片路径为空')),
            fail
          }))
          paths.push(path)
        }
        resolve(paths)
      } catch (e) {
        paths.forEach(path => wx.getFileSystemManager().unlink({ filePath: path, fail() {} }))
        reject(e)
      } finally {
        canvas.width = 1; canvas.height = 1
      }
    })
  })
}

async function exportReport(page) {
  if (page._exportingReport) return
  page._exportingReport = true
  wx.showLoading({ title: '正在排版报告' })
  let paths = []
  try {
    const current = page.data || {}
    if (Object.prototype.hasOwnProperty.call(current, 'valuationReport')) {
      if (current.valuationLoading) throw new Error('评估正在生成，请完成后再导出')
      if (current.valuationDirty) throw new Error('房产信息已修改，请重新评估后导出')
      if (current.valuationError) throw new Error('当前评估失败，请重新生成后导出')
      if (!current.valuationReport || !READY_STATUSES.includes(current.valuationReport.status)) throw new Error('请先生成完整评估结果')
    }
    const data = collect({ data: snapshot(current) })
    paths = await draw(page, data)
    const result = await pdf.generate(paths)
    wx.hideLoading()
    await new Promise((resolve, reject) => wx.openDocument({ filePath: result.path, fileType: 'pdf', showMenu: true, success: resolve, fail: reject }))
    return { ok: true, path: result.path, valuationId: data.valuationId || '' }
  } catch (err) {
    wx.hideLoading()
    wx.showToast({ title: err.message || err.errMsg || '报告生成失败', icon: 'none' })
    return { ok: false, error: err.message || err.errMsg || '报告生成失败' }
  } finally {
    paths.forEach(path => wx.getFileSystemManager().unlink({ filePath: path, fail() {} }))
    page._exportingReport = false
  }
}
module.exports = { exportReport, collect, collectValuation }
