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

function collect(page) {
  const d = page.data || {}
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
      { label: category.name + '评分', value: category.score + '分（' + category.pct + '%）', emphasis: true, group: '投资维度' },
      { label: '判断标准', value: category.threshold, group: category.name, detail: true },
      ...(category.details || []).map(detail => ({ label: detail.label, value: detail.value, group: category.name, detail: true, highlight: detail.highlight }))
    ]),
    { label: '自住综合评分', value: report.advice.selfuse && report.advice.selfuse.totalScore + '分', emphasis: true, group: '自住结论' },
    { label: '自住建议', value: report.advice.selfuse && report.advice.selfuse.level, emphasis: true, group: '自住结论' },
    ...(report.advice.selfuse && report.advice.selfuse.categories || []).flatMap(category => [
      { label: category.name + '评分', value: category.score + '分（' + category.pct + '%）', emphasis: true, group: '自住维度' },
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

function drawReport(ctx, data, width) {
  const scale = width / 750
  const left = 54 * scale
  const right = width - left
  const contentWidth = right - left
  let y = 0
  const colors = { navy: '#243a34', blue: '#356f61', cyan: '#73a99a', text: '#2e3935', muted: '#718078', line: '#e1e8e2', pale: '#f6f8f5', strong: '#356f61', green: '#438260', orange: '#a8693c', red: '#a64c42' }
  const font = (size, bold) => (bold ? 'bold ' : '') + Math.round(size * scale) + 'px sans-serif'
  const text = (s, x, yy, size, color, bold) => { ctx.font = font(size, bold); ctx.fillStyle = color || colors.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(String(s), x, yy) }
  const wrap = (s, x, yy, max, size, color, bold) => {
    ctx.font = font(size, bold); ctx.fillStyle = color || colors.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    let row = '', cy = yy
    String(s).split('').forEach(ch => { if (ctx.measureText(row + ch).width > max && row) { ctx.fillText(row, x, cy); cy += size * scale * 1.55; row = ch } else row += ch })
    if (row) ctx.fillText(row, x, cy)
    return cy + size * scale * 1.55
  }
  const line = () => { ctx.strokeStyle = colors.line; ctx.lineWidth = scale; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); y += 18 * scale }
  const section = (number, title) => {
    y += 25 * scale
    ctx.fillStyle = colors.blue; ctx.fillRect(left, y, 9 * scale, 34 * scale)
    text(number, left + 20 * scale, y + 1 * scale, 15, colors.blue, true)
    text(title, left + 64 * scale, y, 19, colors.navy, true)
    y += 48 * scale
  }
  const group = title => {
    y += 18 * scale
    ctx.fillStyle = '#f8faf9'; ctx.fillRect(left, y, contentWidth, 32 * scale)
    ctx.fillStyle = colors.blue; ctx.fillRect(left, y, 4 * scale, 32 * scale)
    text('分组', left + 14 * scale, y + 9 * scale, 10, colors.muted, true)
    text(title, left + 60 * scale, y + 8 * scale, 12, colors.strong, true)
    y += 44 * scale
  }
  const scoreCard = (x, title, score, level, accent) => {
    const cardW = (contentWidth - 14 * scale) / 2
    ctx.fillStyle = '#fbfcf9'; ctx.fillRect(x, y, cardW, 96 * scale)
    ctx.fillStyle = accent; ctx.fillRect(x, y, 3 * scale, 96 * scale)
    text(title, x + 16 * scale, y + 13 * scale, 11, colors.muted, true)
    text(score === '' ? '—' : score + '分', x + 16 * scale, y + 32 * scale, 24, colors.navy, true)
    text(level, x + 16 * scale, y + 70 * scale, 11, accent, true)
  }
  const row = item => {
    if (!item || !item.value || item.value === 'undefined') return
    const labelX = left + (item.detail ? 48 : 14) * scale
    const valueX = left + (item.detail ? 220 : 200) * scale
    const rowTop = y
    const rowHeight = item.emphasis ? 68 : (item.detail ? 48 : 42)
    
    // 背景和装饰
    if (item.warning) { 
      ctx.fillStyle = '#fff8f0'; 
      ctx.fillRect(left, rowTop, contentWidth, Math.max(rowHeight, 56) * scale)
      ctx.fillStyle = colors.orange
      ctx.fillRect(left, rowTop, 4 * scale, Math.max(rowHeight, 56) * scale)
    }
    else if (item.emphasis) { 
      ctx.fillStyle = '#f0f6fa'
      ctx.fillRect(left, rowTop, contentWidth, rowHeight * scale)
      ctx.fillStyle = colors.blue
      ctx.fillRect(left, rowTop, 4 * scale, rowHeight * scale)
    }
    else if (item.detail) { 
      ctx.fillStyle = '#fafbfc'
      ctx.fillRect(left + 28 * scale, rowTop, contentWidth - 28 * scale, rowHeight * scale)
      ctx.fillStyle = colors.cyan
      ctx.fillRect(left + 32 * scale, rowTop + 10 * scale, 3 * scale, 28 * scale)
    }
    else { 
      ctx.strokeStyle = colors.line
      ctx.lineWidth = 0.6 * scale
      ctx.beginPath()
      ctx.moveTo(left + 10 * scale, rowTop + rowHeight * scale)
      ctx.lineTo(right - 10 * scale, rowTop + rowHeight * scale)
      ctx.stroke()
    }
    
    // 详细项图标
    if (item.detail) {
      text('▸', left + 40 * scale, rowTop + 11 * scale, 14, colors.cyan, true)
    }
    
    // 标签
    text(item.label, labelX, rowTop + (item.emphasis ? 14 : (item.detail ? 12 : 10)) * scale, 
         item.emphasis ? 13 : (item.detail ? 11 : 11), 
         item.warning ? colors.orange : (item.highlight ? colors.green : colors.muted), 
         item.emphasis || item.highlight)
    
    // 值
    const valueColor = item.warning ? colors.red : item.highlight ? colors.green : colors.text
    const end = wrap(item.value, valueX, rowTop + (item.emphasis ? 13 : (item.detail ? 11 : 9)) * scale, 
                    contentWidth - (item.detail ? 236 : 216) * scale, 
                    item.emphasis ? 16 : (item.detail ? 12 : 11), 
                    valueColor, 
                    item.emphasis || item.highlight)
    
    y = Math.max(rowTop + rowHeight * scale, end + 10 * scale)
    
    // 备注
    if (item.note) {
      y = wrap(item.note, valueX, y - 4 * scale, contentWidth - 216 * scale, 10, colors.muted) + 8 * scale
    }
  }

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, 16000 * scale)
  ctx.fillStyle = colors.blue; ctx.fillRect(left, 30 * scale, 4 * scale, 116 * scale)
  text('购房指南', left + 20 * scale, 32 * scale, 13, colors.blue, true)
  text('房产评估报告', left + 20 * scale, 62 * scale, 25, colors.navy, true)
  wrap(data.title, left + 20 * scale, 101 * scale, contentWidth - 40 * scale, 15, colors.text, true)
  ctx.strokeStyle = colors.line; ctx.lineWidth = scale; ctx.beginPath(); ctx.moveTo(left, 162 * scale); ctx.lineTo(right, 162 * scale); ctx.stroke()
  text(data.subtitle || '购房决策参考', left, 178 * scale, 11, colors.muted)
  text(data.updatedAt ? '数据更新  ' + data.updatedAt : '报告生成  ' + new Date().toLocaleDateString(), right - 190 * scale, 178 * scale, 10, colors.muted)
  y = 218 * scale

  ctx.fillStyle = '#f4f8f5'; ctx.fillRect(left, y, contentWidth, 66 * scale)
  ctx.fillStyle = colors.cyan; ctx.fillRect(left, y, 3 * scale, 66 * scale)
  text('报告说明', left + 16 * scale, y + 11 * scale, 11, colors.blue, true)
  wrap('汇总房屋基础信息、区域价值、购置建议与相关测算，供看房和购房决策时参考。', left + 16 * scale, y + 32 * scale, contentWidth - 32 * scale, 11, colors.text)
  y += 91 * scale

  // 决策摘要：先给结论，再展开依据
  text('决策摘要', left, y, 14, colors.navy, true)
  text(data.summary.dataStatus, right - 92 * scale, y + 2 * scale, 10, data.summary.dataStatus === '数据完整' ? colors.green : colors.orange, true)
  y += 28 * scale
  scoreCard(left, '投资维度', data.summary.investmentScore, data.summary.investmentLevel, '#1769aa')
  scoreCard(left + (contentWidth + 14 * scale) / 2, '自住维度', data.summary.selfuseScore, data.summary.selfuseLevel, '#168c9a')
  y += 132 * scale
  text('报告结构', left, y, 12, colors.muted, true)
  text('01 基本信息   02 价值分析   03 购置建议   04 工具测算', left + 72 * scale, y, 11, colors.text)
  y += 22 * scale

  data.sections.forEach(sec => {
    section(sec.number, sec.title)
    let lastGroup = ''
    ;(sec.items || []).forEach(item => {
      if (item.group && item.group !== lastGroup) { group(item.group); lastGroup = item.group }
      row(item)
    })
    line()
  })
  if (data.missing && data.missing.length) {
    y += 8 * scale; ctx.fillStyle = '#fff4ec'; ctx.fillRect(left, y, contentWidth, 56 * scale)
    text('数据完整性提示', left + 14 * scale, y + 10 * scale, 12, colors.orange, true)
    wrap('以下字段缺少后台数据：' + data.missing.join('、'), left + 14 * scale, y + 31 * scale, contentWidth - 28 * scale, 10, colors.red)
    y += 76 * scale
  }
  y += 12 * scale
  ctx.fillStyle = '#f4f8fa'; ctx.fillRect(left, y, contentWidth, 86 * scale)
  text('使用边界', left + 16 * scale, y + 13 * scale, 12, colors.cyan, true)
  wrap('本报告由购房指南根据当前保存信息和后台数据自动生成，仅供筛选、估值和预算参考。产权、交易、学区、贷款、税费及现场状况应以正式文件、银行审批和现场核验结果为准。', left + 16 * scale, y + 36 * scale, contentWidth - 32 * scale, 10, colors.text)
  y += 116 * scale
  text('购房指南智能评估系统', left, y, 11, colors.muted)
  text('— END —', right - 60 * scale, y, 10, colors.muted)
  return y + 36 * scale
}

function draw(page, data) {
  return new Promise(resolve => {
    const query = wx.createSelectorQuery().in(page)
    query.select('#pdfCanvas').fields({ node: true, size: true }).exec(res => {
      const item = res && res[0]
      if (!item || !item.node) return resolve({ ok: false, error: '报告画布不可用' })
      const canvas = item.node
      const dpr = wx.getWindowInfo ? (wx.getWindowInfo().pixelRatio || 2) : 2
      const logicalWidth = 750
      const measureContext = canvas.getContext('2d')
      const height = drawReport(measureContext, data, logicalWidth)
      canvas.width = logicalWidth * dpr
      canvas.height = height * dpr
      const drawContext = canvas.getContext('2d')
      drawContext.scale(dpr, dpr)
      drawReport(drawContext, data, logicalWidth)
      setTimeout(() => wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width: logicalWidth, height, destWidth: logicalWidth * 2, destHeight: height * 2, fileType: 'jpg', quality: 1,
        success: result => result && result.tempFilePath ? resolve({ ok: true, path: result.tempFilePath }) : resolve({ ok: false, error: '报告图片路径为空' }),
        fail: error => resolve({ ok: false, error: error.errMsg || '报告图片生成失败' })
      }), 300)
    })
  })
}

function exportReport(page) {
  wx.showLoading({ title: '正在生成报告' })
  const data = collect(page)
  draw(page, data).then(result => { if (!result.ok) throw new Error(result.error); return pdf.generate(result.path) }).then(result => { wx.hideLoading(); wx.openDocument({ filePath: result.path, fileType: 'pdf', showMenu: true }) }).catch(err => { wx.hideLoading(); wx.showToast({ title: err.message || '报告生成失败', icon: 'none' }) })
}

module.exports = { exportReport, collect }
