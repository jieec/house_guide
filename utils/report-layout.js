// A4 report layout in logical canvas pixels. Layout and painting are separate so
// each page uses a bounded canvas and long content never depends on canvas height.
const W = 750, H = 1061, M = 48, CW = W - M * 2, BOTTOM = 979
const C = { ink: '#2A2846', deep: '#372C57', purple: '#52467B', muted: '#6C6A8E', pale: '#F6F5FC', tint: '#EFECFA', lavender: '#E7E3F6', line: '#D8D3EC', white: '#FFFFFF', warning: '#8A5A2B' }
const font = (size, bold, serif) => (bold ? 'bold ' : '') + size + 'px ' + (serif ? '"WenKai","STKaiti","KaiTi",' : '') + '"PingFang SC","Microsoft YaHei",sans-serif'

function buildPages(ctx, data) {
  const pages = []
  let page, y, sectionName = '', sectionNumber = ''
  const add = cmd => page.commands.push(cmd)
  const rect = (x, yy, w, h, fill, radius = 14) => add({ type: 'rect', x, y: yy, w, h, fill, radius })
  const text = (s, x, yy, size = 18, color = C.ink, bold = false, serif = false) => add({ type: 'text', text: String(s == null ? '' : s).replace(/[✓✗△]/g, ''), x, y: yy, size, color, bold, serif })
  function lines(s, width, size, bold = false, serif = false) {
    ctx.font = font(size, bold, serif)
    const out = []
    String(s == null ? '' : s).split(/\r?\n/).forEach(paragraph => {
      let line = ''
      for (const ch of Array.from(paragraph)) {
        if (line && ctx.measureText(line + ch).width > width) { out.push(line); line = '' }
        line += ch
      }
      out.push(line)
    })
    return out
  }
  function multiline(list, x, yy, size = 18, color = C.ink, bold = false, serif = false) {
    list.forEach((s, i) => text(s, x, yy + i * size * 1.5, size, color, bold, serif))
    return yy + list.length * size * 1.5
  }
  function newPage(continuation = false) {
    page = { commands: [], section: sectionName }; pages.push(page)
    rect(0, 0, W, H, C.pale, 0)
    text('购房指南  /  PROPERTY INSIGHT', M, 26, 12, C.muted)
    rect(M, 54, CW, 1, C.line, 0)
    y = 80
    if (sectionName) {
      text(sectionNumber, M, y, 38, C.purple, false, true)
      text(sectionName + (continuation ? ' · 续' : ''), M + 76, y + 5, 28, C.deep, false, true)
      y += 62
    }
  }
  function ensure(height) { if (y + height > BOTTOM) newPage(true) }
  function group(title) {
    const ls = lines(title, CW - 40, 18, true)
    ensure(ls.length * 27 + 28 + 120)
    rect(M, y, CW, ls.length * 27 + 16, C.lavender, 10)
    multiline(ls, M + 18, y + 8, 18, C.purple, true)
    y += ls.length * 27 + 28
  }
  function row(item) {
    if (!item || item.value === undefined || item.value === null) return
    const label = lines(item.label || '项目', 156, 16)
    const size = item.emphasis ? 20 : 17
    const vals = lines(item.value, CW - 220, size, !!item.emphasis)
    const notes = item.note ? lines(item.note, CW - 220, 14) : []
    // Uniform line slots let labels, values and notes split safely together.
    const slots = vals.map(t => ({t, size, color: item.warning ? C.warning : C.deep, bold: !!item.emphasis}))
      .concat(notes.map(t => ({t, size: 14, color: C.muted, bold: false})))
    const count = Math.max(label.length, slots.length, 1), step = 27
    let start = 0
    const full = count * step + 24
    if (full <= BOTTOM - 142) ensure(full + 10)
    while (start < count) {
      ensure(84)
      const n = Math.min(count - start, Math.floor((BOTTOM - y - 24) / step))
      const h = n * step + 24
      rect(M, y, CW, h, item.warning ? '#F8F1E9' : item.emphasis ? C.tint : C.white)
      if (item.emphasis || item.highlight) rect(M, y + 14, 4, h - 28, C.purple, 2)
      for (let i = 0; i < n; i++) {
        const idx = start + i, yy = y + 14 + i * step
        if (label[idx]) text(label[idx], M + 18, yy, 16, C.muted)
        else if (i === 0 && start > 0) text('（续）', M + 18, yy, 14, C.muted)
        const v = slots[idx]; if (v) text(v.t, M + 198, yy, v.size, v.color, v.bold)
      }
      y += h + 10; start += n
    }
  }
  function scoreCard(x, yy, width, title, score, level) {
    const ls = lines(level || '暂无结论', width - 36, 16)
    rect(x, yy, width, 150 + Math.max(0, ls.length - 1) * 24, C.tint, 20)
    text(title, x + 20, yy + 18, 16, C.muted)
    text(score === '' || score == null ? '—' : score + ' 分', x + 20, yy + 48, 44, C.deep, false, true)
    multiline(ls, x + 20, yy + 112, 16, C.purple)
  }
  function infoCards(items) {
    for (let i = 0; i < items.length;) {
      const pair = items.slice(i, i + 2)
      const w = (CW - 14) / 2
      const content = pair.map(it => ({
        label: lines(it.label, w - 32, 15), value: lines(it.value, w - 32, 20),
        note: it.note ? lines(it.note, w - 32, 14) : []
      }))
      const h = Math.max(...content.map(c => 30 + c.label.length * 22.5 + c.value.length * 30 + c.note.length * 21))
      if (h > 300) { row(items[i++]); continue }
      ensure(h + 12)
      content.forEach((c, j) => {
        const x = M + j * (w + 14)
        rect(x, y, w, h, j ? C.white : C.tint, 16)
        let yy = multiline(c.label, x + 16, y + 14, 15, C.muted) + 8
        yy = multiline(c.value, x + 16, yy, 20, C.deep)
        multiline(c.note, x + 16, yy, 14, C.muted)
      })
      y += h + 12; i += pair.length
    }
  }
  function adviceChart(advice) {
    ensure(388)
    const w = (CW - 18) / 2
    ;[['investment', '投资参考'], ['selfuse', '自住参考']].forEach(([key, title], col) => {
      const d = advice[key]; if (!d) return
      const x = M + col * (w + 18)
      rect(x, y, w, 340, C.white, 20)
      text(title, x + 18, y + 18, 17, C.muted)
      text(d.totalScore + ' 分', x + 18, y + 48, 42, C.deep, false, true)
      text(d.level, x + 18, y + 103, 17, C.purple)
      ;(d.categories || []).forEach((c, i) => {
        const yy = y + 148 + i * 58
        text(c.name, x + 18, yy, 16, C.ink)
        text(c.score + '分 / ' + c.pct + '%', x + 150, yy, 14, C.muted)
        rect(x + 18, yy + 27, w - 36, 8, C.tint, 4)
        if (c.pct > 0) rect(x + 18, yy + 27, (w - 36) * Math.min(c.pct, 100) / 100, 8, '#8378AC', 4)
      })
    })
    y += 352
    text('综合分按原权重计算；百分比为分项分数占分项合计的比例。', M, y, 14, C.muted)
    y += 38
  }

  // Cover: compact enough to include a useful overview, not an empty title page.
  newPage()
  rect(M, 82, CW, 8, C.purple, 4)
  text('购房决策参考', M, 119, 18, C.muted)
  text('房产评估报告', M, 160, 48, C.deep, false, true)
  const titleLines = lines(data.title || '房产评估报告', CW, 30, false, true)
  y = multiline(titleLines.slice(0, 4), M, 234, 30, C.purple, false, true) + 16
  // Full property name is repeated as a wrapping row if it exceeds the cover.
  y = multiline(lines(data.subtitle || '小区分析 · 价值判断 · 购房预算', CW, 17), M, y, 17, C.muted) + 20
  text('数据更新  ' + (data.updatedAt || '未提供'), M, y, 14, C.muted); y += 24
  text('生成日期  ' + (data.generatedAt || new Date().toISOString().slice(0, 10)), M, y, 14, C.muted); y += 40
  const summary = data.summary || {}
  ensure(180)
  scoreCard(M, y, (CW - 18) / 2, '投资参考', summary.investmentScore, summary.investmentLevel)
  scoreCard(M + (CW + 18) / 2, y, (CW - 18) / 2, '自住参考', summary.selfuseScore, summary.selfuseLevel)
  y += 180
  const highlights = (data.chart || []).filter(it => ['小区均价', '评估价格', '城市均价'].includes(it.label))
  if (highlights.length) {
    ensure(120)
    const width = (CW - (highlights.length - 1) * 12) / highlights.length
    highlights.forEach((it, i) => {
      const x = M + i * (width + 12)
      rect(x, y, width, 108, C.white, 16)
      text(it.label, x + 16, y + 15, 16, C.muted)
      const ls = lines(it.value, width - 32, 27, false, true)
      multiline(ls, x + 16, y + 40, 27, C.deep, false, true)
      text('元/㎡', x + 16, y + 81, 12, C.muted)
    })
    y += 132
  }
  group('报告导览')
  ;(data.sections || []).forEach(sec => {
    ensure(38); text(sec.number, M + 18, y, 17, C.purple, true)
    text(sec.title, M + 66, y, 17, C.ink); y += 36
  })
  if (titleLines.length > 4) row({label: '完整小区名称', value: data.title})

  for (const sec of data.sections || []) {
    sectionName = sec.title; sectionNumber = sec.number; newPage()
    let lastGroup = '', items = sec.items || []
    if (sec.number === '01') { infoCards(items); continue }
    if (sec.number === '03' && data.adviceVisual && data.adviceVisual.investment && data.adviceVisual.selfuse) {
      adviceChart(data.adviceVisual)
      const labels = ['投资综合评分', '投资建议', '自住综合评分', '自住建议']
      ;['investment', 'selfuse'].forEach(k => (data.adviceVisual[k].categories || []).forEach(c => labels.push(c.name + '评分')))
      items = items.filter(it => !labels.includes(it.label))
    }
    if (sec.number === '02' && (data.chart || []).length) {
      group('价格全景  /  元每平方米')
      const max = Math.max(...data.chart.map(it => Number(it.amount) || 0), 0)
      for (const it of data.chart) {
        const note = it.note ? lines(it.note, CW - 40, 14) : []
        const h = 91 + note.length * 21
        ensure(h + 12); rect(M, y, CW, h, C.white)
        text(it.label, M + 18, y + 14, 17, C.muted)
        text(it.value, M + 470, y + 11, 24, C.deep, false, true)
        rect(M + 18, y + 50, CW - 36, 12, C.tint, 6)
        if (max && it.amount > 0) rect(M + 18, y + 50, (CW - 36) * it.amount / max, 12, it.label === '评估价格' ? C.purple : '#A198C4', 6)
        multiline(note, M + 18, y + 72, 14, C.muted)
        y += h + 12
      }
      items = items.slice(data.chart.length)
      group('价格明细')
    }
    for (const item of items) {
      if (item.group && item.group !== lastGroup) {
        if (item.group !== '工具结论') group(item.group)
        lastGroup = item.group
      }
      row(item)
    }
    if (!items.length && sec.number !== '02') row({label: '数据状态', value: '暂无数据'})
  }
  group('报告说明')
  if ((data.missing || []).length) row({label: '待核实字段', value: data.missing.join('、'), warning: true})
  row({label: '使用边界', value: '本报告根据当前保存信息与后台数据生成，仅供筛选、估值和预算参考。产权、交易、学区、贷款、税费及现场状况应以正式文件、银行审批和现场核验结果为准。'})
  pages.forEach((p, i) => {
    p.commands.push({type:'rect', x:M, y:1009, w:CW, h:1, fill:C.line, radius:0})
    p.commands.push({type:'text', text:'购房指南 · ' + (i ? p.section : '报告概览'), x:M, y:1022, size:12, color:C.muted})
    p.commands.push({type:'text', text:String(i + 1).padStart(2, '0') + ' / ' + String(pages.length).padStart(2, '0'), x:W - M - 60, y:1022, size:12, color:C.muted})
  })
  return pages
}

function paintPage(ctx, page) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  for (const c of page.commands) {
    if (c.type === 'text') {
      ctx.font = font(c.size, c.bold, c.serif); ctx.fillStyle = c.color; ctx.fillText(c.text, c.x, c.y)
    } else {
      ctx.fillStyle = c.fill
      const r = Math.min(c.radius, c.w / 2, c.h / 2), x = c.x, y = c.y, w = c.w, h = c.h
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r)
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); ctx.fill()
    }
  }
}
module.exports = { buildPages, paintPage, width: W, height: H }
