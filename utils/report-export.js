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
    note: item.note || ''
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
    { label: '投资综合评分', value: report.advice.investment && report.advice.investment.totalScore + '分' },
    { label: '投资建议', value: report.advice.investment && report.advice.investment.level },
    ...(report.advice.investment && report.advice.investment.categories || []).flatMap(category => [
      { label: category.name + '评分', value: category.score + '分（' + category.pct + '%）' },
      { label: category.name + '判断标准', value: category.threshold },
      ...(category.details || []).map(detail => ({ label: category.name + ' · ' + detail.label, value: detail.value }))
    ]),
    { label: '自住综合评分', value: report.advice.selfuse && report.advice.selfuse.totalScore + '分' },
    { label: '自住建议', value: report.advice.selfuse && report.advice.selfuse.level },
    ...(report.advice.selfuse && report.advice.selfuse.categories || []).flatMap(category => [
      { label: category.name + '评分', value: category.score + '分（' + category.pct + '%）' },
      { label: category.name + '判断标准', value: category.threshold },
      ...(category.details || []).map(detail => ({ label: category.name + ' · ' + detail.label, value: detail.value }))
    ])
  ] : Object.keys({ ...savedConclusion, ...d }).map(k => ({ label: k, value: ({ ...savedConclusion, ...d })[k] }))
  const policyItems = (report.policies || []).flatMap(policy => Object.keys(policy).map(key => ({ label: (policy.city || '政策') + ' · ' + key, value: policy[key] })))
  const toolItems = []
  ;(report.tools || []).forEach(tool => {
    toolItems.push({ label: tool.label, value: tool.value || tool.note })
    ;(tool.parts || []).forEach(part => toolItems.push({ label: '  ' + part.name, value: part.value }))
  })
  if (!toolItems.length) Object.keys(savedFinance).forEach(k => toolItems.push({ label: k, value: savedFinance[k] }))
  return {
    title: selected.community || d.communityName || savedBasic.communityName || '房产评估报告',
    subtitle: [selected.city || d.city, selected.district || d.district].filter(Boolean).join(' '),
    updatedAt: d.updatedAt || '',
    sections: [
      { number: '01', title: '基本信息', items: lineItems(basic).concat(lineItems([{ label: '交通配套', value: report.traffic }, { label: '教育配套', value: report.schools }, { label: '周边竞品', value: report.competitors && report.competitors.map(i => i.name + ' ' + i.value) }])) },
      { number: '02', title: '价值分析', items: lineItems(prices) },
      { number: '03', title: '购置建议', items: lineItems(advice).concat(policyItems).concat(report.missing && report.missing.length ? [{ label: '待核实数据', value: report.missing }] : []) },
      { number: '04', title: '工具使用与测算', items: lineItems(toolItems).concat(d.loanResult && d.loanResult.valid ? lineItems(d.loanResult.parts) : []) }
    ]
  }
}

function drawReport(ctx, data, width, measureOnly) {
  const scale = width / 750
  const left = 58 * scale
  const right = width - left
  const contentWidth = right - left
  let y = 0
  const colors = { navy: '#102744', blue: '#1479d1', cyan: '#20b8c9', text: '#1b2b40', muted: '#6f8094', line: '#dce6ef', pale: '#f3f7fb', orange: '#f28a45' }
  const font = (size, bold) => (bold ? 'bold ' : '') + Math.round(size * scale) + 'px sans-serif'
  const text = (s, x, yy, size, color, bold) => { ctx.font = font(size, bold); ctx.fillStyle = color || colors.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(String(s), x, yy) }
  const wrap = (s, x, yy, max, size, color, bold) => {
    ctx.font = font(size, bold); ctx.fillStyle = color || colors.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    let row = '', cy = yy
    String(s).split('').forEach(ch => { if (ctx.measureText(row + ch).width > max && row) { ctx.fillText(row, x, cy); cy += size * scale * 1.6; row = ch } else row += ch })
    if (row) ctx.fillText(row, x, cy)
    return cy + size * scale * 1.6
  }
  const rule = () => { ctx.strokeStyle = colors.line; ctx.lineWidth = scale; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); y += 24 * scale }
  const heading = (number, title) => { y += 28 * scale; ctx.fillStyle = colors.blue; ctx.fillRect(left, y, 8 * scale, 34 * scale); text(number, left + 22 * scale, y - 1 * scale, 18, colors.blue, true); text(title, left + 66 * scale, y - 1 * scale, 18, colors.navy, true); y += 52 * scale }
  const row = item => { ctx.fillStyle = colors.pale; ctx.fillRect(left, y, contentWidth, 1 * scale); text(item.label, left + 14 * scale, y + 13 * scale, 13, colors.muted); const end = wrap(item.value, left + 190 * scale, y + 11 * scale, contentWidth - 206 * scale, 13, colors.text, false); y = Math.max(y + 42 * scale, end + 10 * scale); if (item.note) { y = wrap(item.note, left + 190 * scale, y - 5 * scale, contentWidth - 206 * scale, 10, colors.muted) + 8 * scale } }

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, 10000 * scale)
  ctx.fillStyle = colors.navy; ctx.fillRect(0, 0, width, 184 * scale)
  ctx.fillStyle = colors.cyan; ctx.fillRect(0, 0, 18 * scale, 184 * scale)
  text('购房指南', left, 34 * scale, 14, '#9bd9e2', true)
  wrap(data.title, left, 62 * scale, contentWidth, 30, '#ffffff', true)
  text(data.subtitle || '基本信息 · 价值分析 · 购置建议 · 工具使用', left, 125 * scale, 13, '#c7d8e9')
  text(data.updatedAt ? '数据更新：' + data.updatedAt : '报告生成：' + new Date().toLocaleDateString(), right - 210 * scale, 125 * scale, 11, '#c7d8e9')
  y = 224 * scale
  data.sections.forEach(section => { heading(section.number, section.title); (section.items || []).forEach(row); rule() })
  y += 22 * scale
  ctx.fillStyle = '#eef8fa'; ctx.fillRect(left, y, contentWidth, 82 * scale)
  text('使用说明', left + 16 * scale, y + 14 * scale, 12, colors.cyan, true)
  wrap('本报告由购房指南根据当前已保存信息和后台数据自动生成，仅供购房筛选和预算参考。产权、交易、学区、贷款及现场状况请以正式文件和实际核验结果为准。', left + 16 * scale, y + 36 * scale, contentWidth - 32 * scale, 11, colors.text)
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
      const height = drawReport(measureContext, data, logicalWidth, true)
      canvas.width = logicalWidth * dpr
      canvas.height = height * dpr
      const drawContext = canvas.getContext('2d')
      drawContext.scale(dpr, dpr)
      drawReport(drawContext, data, logicalWidth, false)
      setTimeout(() => wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: logicalWidth,
        height,
        destWidth: logicalWidth * 2,
        destHeight: height * 2,
        fileType: 'jpg',
        quality: 1,
        success: result => {
          if (!result || !result.tempFilePath) return resolve({ ok: false, error: '报告图片路径为空' })
          wx.getFileInfo({
            filePath: result.tempFilePath,
            success: info => resolve(info.size > 1000 ? { ok: true, path: result.tempFilePath } : { ok: false, error: '报告图片为空，请重试' }),
            fail: () => resolve({ ok: true, path: result.tempFilePath })
          })
        },
        fail: error => resolve({ ok: false, error: error.errMsg || '报告图片生成失败' })
      }), 300)
    })
  })
}

function exportReport(page) {
  wx.showLoading({ title: '正在生成报告' })
  const data = collect(page)
  draw(page, data).then(result => {
    if (!result.ok) throw new Error(result.error)
    return pdf.generate(result.path)
  }).then(result => {
    wx.hideLoading()
    wx.openDocument({ filePath: result.path, fileType: 'pdf', showMenu: true })
  }).catch(err => {
    wx.hideLoading()
    wx.showToast({ title: err.message || '报告生成失败', icon: 'none' })
  })
}

module.exports = { exportReport, collect }
