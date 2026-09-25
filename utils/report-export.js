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
    toolItems.push({ label: tool.label, value: tool.value || tool.note, group: '工具结论', emphasis: true })
    ;(tool.parts || []).forEach(part => toolItems.push({ label: part.name, value: part.value, group: tool.label, detail: true }))
    if (tool.formula) toolItems.push({ label: '计算口径', value: tool.formula, group: tool.label, detail: true })
    if (tool.warning) toolItems.push({ label: '风险提示', value: tool.warning, group: tool.label, warning: true })
  })
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
    y += 14 * scale
    ctx.fillStyle = '#f3f6f5'; ctx.fillRect(left, y, contentWidth, 26 * scale)
    text('明细', left + 12 * scale, y + 6 * scale, 10, colors.muted, true)
    text(title, left + 55 * scale, y + 5 * scale, 11, colors.strong, true)
    y += 36 * scale
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
    const labelX = left + (item.detail ? 42 : 14) * scale
    const valueX = left + (item.detail ? 210 : 190) * scale
    const rowTop = y
    const rowHeight = item.emphasis ? 62 : 40
    if (item.warning) { ctx.fillStyle = '#fff2ea'; ctx.fillRect(left, rowTop, contentWidth, Math.max(rowHeight, 52) * scale); ctx.fillStyle = colors.orange; ctx.fillRect(left, rowTop, 4 * scale, Math.max(rowHeight, 52) * scale) }
    else if (item.emphasis) { ctx.fillStyle = '#f0f6fa'; ctx.fillRect(left, rowTop, contentWidth, rowHeight * scale); ctx.fillStyle = colors.blue; ctx.fillRect(left, rowTop, 4 * scale, rowHeight * scale) }
    else if (item.detail) { ctx.fillStyle = '#f8fafb'; ctx.fillRect(left + 20 * scale, rowTop, contentWidth - 20 * scale, rowHeight * scale); ctx.fillStyle = '#b9cbd7'; ctx.fillRect(left + 25 * scale, rowTop + 8 * scale, 2 * scale, 24 * scale) }
    else { ctx.strokeStyle = colors.line; ctx.lineWidth = 0.6 * scale; ctx.beginPath(); ctx.moveTo(left + 10 * scale, rowTop + rowHeight * scale); ctx.lineTo(right - 10 * scale, rowTop + rowHeight * scale); ctx.stroke() }
    if (item.detail) text('›', left + 36 * scale, rowTop + 8 * scale, 13, colors.muted, true)
    text(item.label, labelX, rowTop + (item.emphasis ? 12 : 10) * scale, item.emphasis ? 12 : 11, item.warning ? colors.orange : colors.muted, item.emphasis)
    const end = wrap(item.value, valueX, rowTop + (item.emphasis ? 10 : 9) * scale, contentWidth - (item.detail ? 226 : 206) * scale, item.emphasis ? 15 : 11, item.warning ? colors.red : item.highlight ? colors.green : colors.text, item.emphasis || item.highlight)
    y = Math.max(rowTop + rowHeight * scale, end + 8 * scale)
    if (item.note) y = wrap(item.note, valueX, y - 3 * scale, contentWidth - 206 * scale, 10, colors.muted) + 6 * scale
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
