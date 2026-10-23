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
    const data = collect(page)
    paths = await draw(page, data)
    const result = await pdf.generate(paths)
    wx.hideLoading()
    await new Promise((resolve, reject) => wx.openDocument({ filePath: result.path, fileType: 'pdf', showMenu: true, success: resolve, fail: reject }))
  } catch (err) {
    wx.hideLoading()
    wx.showToast({ title: err.message || err.errMsg || '报告生成失败', icon: 'none' })
  } finally {
    paths.forEach(path => wx.getFileSystemManager().unlink({ filePath: path, fail() {} }))
    page._exportingReport = false
  }
}
module.exports = { exportReport, collect }
