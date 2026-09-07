function drawReport(ctx, d, w) {
  const px = w / 375
  let y = 0
  const L = 24 * px, R = w - 24 * px, cW = R - L

  function setColor(c) { ctx.fillStyle = c }
  function setFont(sz, bold) { ctx.font = (bold ? 'bold ' : 'normal ') + (sz * px) + 'px "Microsoft YaHei","SimHei","PingFang SC",sans-serif' }
  function align(a) { ctx.textAlign = a }
  function base() { ctx.textBaseline = 'top' }

  function wrapText(t, x, YY, maxW, sz, color) {
    setFont(sz); align('left'); base(); setColor(color || '#1a1a2e')
    const chars = String(t).split('')
    let line = '', ly = YY
    for (const ch of chars) {
      if (ctx.measureText(line + ch).width > maxW) {
        ctx.fillText(line, x, ly); line = ch; ly += sz * px * 1.5
      } else { line += ch }
    }
    if (line) ctx.fillText(line, x, ly)
    return ly + sz * px * 1.5
  }

  function text(t, x, YY, sz, color) {
    setFont(sz); align('left'); base(); setColor(color || '#1a1a2e')
    ctx.fillText(String(t), x, YY)
  }

  function section(num, title) {
    y += 16 * px
    setColor('#ff7a45')
    ctx.fillRect(L, y, 4 * px, 18 * px)
    setColor('#16213e'); setFont(15, true); align('left'); base()
    ctx.fillText(num + ' ' + title, L + 10 * px, y)
    y += 28 * px
  }

  function kv(k, v) {
    if (!v || v === '-' || v === 'undefined' || v === 'null' || v === '') return
    setColor('#94a3b8'); setFont(11); align('left'); base()
    ctx.fillText(k, L + 4 * px, y)
    const ny = wrapText(String(v), L + 82 * px, y, cW - 86 * px, 11, '#1a1a2e')
    y = Math.max(y + 16 * px, ny + 2 * px)
  }

  function hLine() {
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(L + 4 * px, y); ctx.lineTo(R, y); ctx.stroke()
    y += 6 * px
  }

  function cardBg(color) {
    y += 4 * px
    setColor(color || '#f8fafc')
    ctx.beginPath(); ctx.roundRect(L + 2 * px, y, cW - 4 * px, 0, 4 * px)
  }

  function cardEnd() { y += 10 * px }

  function cardRow(items) {
    const cw = (cW - 8 * px) / items.length
    items.forEach((it, i) => {
      const cx = L + 4 * px + i * cw + cw / 2
      setColor('#f8fafc')
      ctx.beginPath(); ctx.roundRect(cx - cw / 2 + 2 * px, y, cw - 4 * px, 44 * px, 4 * px); ctx.fill()
      setColor('#ff7a45'); setFont(15, true); align('center'); base()
      ctx.fillText(String(it.num || '-'), cx, y + 6 * px)
      setColor('#94a3b8'); setFont(9); align('center')
      ctx.fillText(it.lbl || '', cx, y + 26 * px)
    })
    y += 52 * px
  }

  function riskItem(name, desc) {
    setColor('#fef2f2')
    ctx.beginPath(); ctx.roundRect(L + 4 * px, y, cW - 8 * px, 0, 3 * px); ctx.fill()
    setColor('#dc2626'); setFont(11); align('left'); base()
    const ny = wrapText('• ' + name + (desc ? '：' + desc : ''), L + 10 * px, y + 4 * px, cW - 24 * px, 11, '#dc2626')
    y = ny + 4 * px
  }

  function policyRow(k, v) {
    if (!v) return
    setColor('#64748b'); setFont(11); align('left'); base()
    ctx.fillText(k + '：', L + 10 * px, y)
    const ny = wrapText(v, L + 58 * px, y, cW - 70 * px, 11, '#1a1a2e')
    y = Math.max(y + 16 * px, ny + 2 * px)
  }

  function analysisBlock(title, items) {
    y += 6 * px
    setColor('#f0fdf4')
    ctx.beginPath(); ctx.roundRect(L + 2 * px, y, cW - 4 * px, 0, 6 * px)
    setColor('#166534'); setFont(12, true); align('left'); base()
    ctx.fillText(title, L + 10 * px, y + 8 * px)
    y += 28 * px
    for (const item of items) {
      setColor('#1a1a2e'); setFont(11); align('left'); base()
      const ny = wrapText('• ' + item, L + 10 * px, y, cW - 24 * px, 11, '#374151')
      y = ny + 2 * px
    }
    y += 6 * px
  }

  // ========== 开始绘制 ==========
  setColor('#ffffff'); ctx.fillRect(0, 0, w, 3000 * px)

  // 标题栏
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, '#16213e'); grad.addColorStop(1, '#0f3460')
  setColor(grad); ctx.fillRect(0, 0, w, 80 * px)

  const city = d.city || ''
  const community = d.community || ''
  setColor('#ffffff'); setFont(18, true); align('center'); base()
  ctx.fillText(community ? community + ' 购房评估报告' : city + ' 购房评估报告', w / 2, 16 * px)
  setFont(11); setColor('#94a3b8')
  const now = new Date()
  const ds = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
  ctx.fillText(ds + '  购房指南智能评估系统', w / 2, 48 * px)
  y = 90 * px

  // ========== ① 基本信息 ==========
  section('①', '基本信息')
  const b = d.basic || {}
  kv('城市区域', (city + ' ' + (d.district || '')).trim())
  kv('小区名称', community)
  kv('房龄', b.age ? b.age + '年' : '')
  y += 2 * px
  setColor('#2563eb'); setFont(11, true); align('left'); base()
  ctx.fillText('▸ 配套资源', L + 4 * px, y); y += 16 * px
  kv('区域排名', b.areaRank)
  kv('交通配套', b.traffic)
  kv('教育资源', b.school)
  kv('竞品分析', b.competitors)
  y += 2 * px
  setColor('#2563eb'); setFont(11, true); align('left'); base()
  ctx.fillText('▸ 价格走势', L + 4 * px, y); y += 16 * px
  kv('区域均价', b.avgPrice ? b.avgPrice + '元/㎡' : '')
  kv('近期成交价', b.recentDealPrice ? b.recentDealPrice + '元/㎡' : '')
  kv('成交量', b.recentDealVolume ? b.recentDealVolume + '套' : '')
  kv('历史均价', b.historyPrice ? b.historyPrice + '元/㎡' : '')
  kv('历史最高价', b.historyMax ? b.historyMax + '元/㎡' : '')
  hLine()

  // ========== 小区概况 ==========
  const com = d.communityDoc
  if (com) {
    section('🏘️', '小区概况（安居客数据）')
    const base_ = com.base || {}
    const grade = com.grade || {}
    const price = com.price || {}
    kv('综合评分', grade.score ? grade.score + '分' : '')
    kv('建筑年代', base_.completionTime)
    kv('物业类型', base_.propertyType)
    kv('物业费', base_.propertyFee)
    kv('绿化率', base_.greenRate)
    kv('容积率', base_.plotRatio)
    kv('车位信息', base_.parking)
    kv('开发商', base_.developer)
    kv('挂牌均价', price.price ? price.price + '元/㎡' : '')
    kv('在售套数', price.saleCount ? price.saleCount + '套' : '')
    kv('在租房源', price.rentCount ? price.rentCount + '套' : '')
    kv('一句话点评', com.summary)
    if (grade.score) {
      y += 4 * px
      cardRow([
        { num: grade.traffic || '-', lbl: '交通' },
        { num: grade.school || '-', lbl: '教育' },
        { num: grade.shopping || '-', lbl: '商业' },
        { num: grade.medical || '-', lbl: '医疗' },
        { num: grade.life || '-', lbl: '生活' }
      ])
    }
    const pois = com.pois || {}
    if (pois.bus || pois.school || pois.hospital || pois.mall || pois.park) {
      y += 2 * px
      const cats = { subway: '地铁', bus: '公交', school: '学校', hospital: '医院', mall: '商场', park: '公园', bank: '银行', market: '菜市场' }
      for (const [k, label] of Object.entries(cats)) {
        const items = pois[k]
        if (!items || !items.length) continue
        const names = items.slice(0, 5).map(i => i.name || '').filter(Boolean).join('、')
        if (names) kv(label, names)
      }
    }
    const near = com.nearComms || []
    if (near.length) {
      kv('周边竞品', near.slice(0, 4).map(n => n.name + (n.price ? '(' + n.price + '元/㎡)' : '')).join('、'))
    }
    hLine()
  }

  // ========== ② 房源分析 ==========
  section('②', '房源分析')
  // 子标题：价格信息
  setColor('#2563eb'); setFont(11, true); align('left'); base()
  ctx.fillText('▸ 价格信息', L + 4 * px, y); y += 16 * px
  kv('区域均价', b.avgPrice ? b.avgPrice + '元/㎡' : '')
  kv('近期成交价', d.recentDealPrice ? d.recentDealPrice + '元/㎡' : '')
  kv('历史均价', b.historyPrice ? b.historyPrice + '元/㎡' : '')
  kv('历史最高价', b.historyMax ? b.historyMax + '元/㎡' : '')
  y += 4 * px
  // 子标题：房屋信息
  setColor('#2563eb'); setFont(11, true); align('left'); base()
  ctx.fillText('▸ 房屋信息', L + 4 * px, y); y += 16 * px
  kv('购房目的', d.purpose)
  kv('面积', d.areaC ? d.areaC + '㎡' : '')
  kv('房龄', b.age ? b.age + '年' : '')
  kv('评估总价', d.salePriceC ? d.salePriceC + '万元' : '')
  kv('成交总价', d.evalPriceC ? d.evalPriceC + '万元' : '')
  y += 4 * px
  // 子标题：交易参考
  setColor('#2563eb'); setFont(11, true); align('left'); base()
  ctx.fillText('▸ 交易参考', L + 4 * px, y); y += 16 * px
  kv('挂牌价', d.listingPrice ? d.listingPrice + '元/㎡' : '')
  kv('评估价', d.evalPrice ? d.evalPrice + '元/㎡' : '')
  kv('成交参考价', d.salePrice ? d.salePrice + '元/㎡' : '')
  kv('成交参考均价', d.pricePerSqm ? d.pricePerSqm + '元/㎡' : '')
  kv('成交趋势', d.dealVolume ? d.dealVolume + '套' : '')
  // 性价比卡片
  if (d.gap) {
    y += 6 * px
    setColor('#fff7ed')
    ctx.beginPath(); ctx.roundRect(L + 4 * px, y, cW - 8 * px, 0, 4 * px)
    setColor('#ff7a45'); setFont(11); align('left'); base()
    const ny = wrapText('测算差额：' + d.gap + '元', L + 12 * px, y + 8 * px, cW - 28 * px, 11, '#ff7a45')
    y = ny + 2 * px
    setColor('#7c3aed'); setFont(11, true)
    const ny2 = wrapText('性价比等级：' + (d.grade || '-') + '档  ' + (d.gradeDesc || ''), L + 12 * px, y, cW - 28 * px, 11, '#7c3aed')
    y = ny2 + 10 * px
  }
  hLine()

  // ========== ③ 政策面分析 ==========
  const policies = d.policies || []
  if (policies.length) {
    section('③', '政策面分析')
    for (const pol of policies) {
      if (!pol) continue
      const label = pol.city === '全国' ? '【全国政策】' : '【' + pol.city + '】'
      setColor(pol.city === '全国' ? '#7c3aed' : '#2563eb')
      setFont(12, true); align('left'); base()
      ctx.fillText(label, L + 4 * px, y)
      y += 18 * px
      policyRow('限购', pol.purchase_limit)
      policyRow('限售', pol.sale_limit)
      policyRow('首付', pol.down_payment)
      policyRow('利率', pol.interest_rate)
      policyRow('税费', pol.tax)
      policyRow('公积金', pol.fund)
      policyRow('人才', pol.talent)
      if (pol.summary) { kv('概述', pol.summary) }
      y += 4 * px
    }
    hLine()
  }

  // ========== ④ 融资建议 ==========
  section('④', '融资建议')
  setColor('#2563eb'); setFont(11, true); align('left'); base()
  ctx.fillText('▸ 贷款方案', L + 4 * px, y); y += 16 * px
  kv('评估价', d.loanEvalPrice ? d.loanEvalPrice + '元/㎡' : '')
  kv('按揭金额', d.loanAmount ? d.loanAmount + '元' : '')
  kv('当前利率', d.rate ? d.rate + '%' : '')
  y += 2 * px
  setColor('#2563eb'); setFont(11, true); align('left'); base()
  ctx.fillText('▸ 年龄评估', L + 4 * px, y); y += 16 * px
  kv('本人年龄', d.age ? d.age + '岁' : '')
  kv('建议贷款年限', d.maxYears ? d.maxYears + '年' : '')
  kv('年龄风险', d.ageRisk ? '⚠️ 楼龄+贷款年限>70，融资受限' : '✓ 正常')
  const banks = d.banks || []
  if (banks.length) {
    y += 4 * px
    setColor('#2563eb'); setFont(11, true); align('left'); base()
    ctx.fillText('▸ 推荐银行', L + 4 * px, y); y += 16 * px
    for (const bk of banks.slice(0, 5)) {
      kv('银行', bk.name + '（' + bk.type + '）')
      kv('电话', bk.phone)
    }
  }
  hLine()

  // ========== 增值内容（仅VIP开启时显示） ==========
  const risks = d.risks || []
  if (d.vip) {
    // ⑤ 风险提示
    if (risks.length || d.ageRisk) {
      section('⑤', '风险提示')
      if (d.ageRisk) {
        riskItem('融资受限风险', '楼龄' + (d.riskAge || '') + '年+贷款' + (d.loanYears || '') + '年>70')
      }
      if (risks.length) {
        setColor('#2563eb'); setFont(11, true); align('left'); base()
        ctx.fillText('▸ 已识别风险项', L + 4 * px, y); y += 16 * px
        for (const r of risks) {
          riskItem(r.name, r.desc)
        }
      }
      hLine()
    }

    // ⑥ 税费测算
    if (d.totalTax) {
      section('⑥', '税费测算')
      kv('评估总价', d.taxTotalPrice ? d.taxTotalPrice + '万元' : '')
      kv('面积', d.taxArea ? d.taxArea + '㎡' : '')
      y += 2 * px
      setColor('#2563eb'); setFont(11, true); align('left'); base()
      ctx.fillText('▸ 税费明细', L + 4 * px, y); y += 16 * px
      kv('契税', d.deedTax ? d.deedTax + '元' : '')
      kv('增值税', d.vatTax ? d.vatTax + '元' : '')
      kv('个人所得税', d.incomeTax ? d.incomeTax + '元' : '')
      kv('税费合计', d.totalTax ? d.totalTax + '元' : '')
      hLine()
    }

    // ⑦ 按揭测算
    if (d.monthly || d.firstMonth) {
      section('⑦', '按揭测算')
      kv('贷款金额', d.mLoanAmount ? d.mLoanAmount + '元' : '')
      kv('利率', d.mRate ? d.mRate + '%' : '')
      y += 2 * px
      setColor('#2563eb'); setFont(11, true); align('left'); base()
      ctx.fillText('▸ 还款明细', L + 4 * px, y); y += 16 * px
      kv('月供', d.monthly ? d.monthly + '元（等额本息）' : d.firstMonth ? '首月' + d.firstMonth + '元（等额本金）' : '')
      kv('还款总额', d.totalRepay ? d.totalRepay + '元' : '')
      kv('利息总额', d.totalInterest ? d.totalInterest + '元' : '')
      hLine()
    }

    // 💡 增值分析
    if (d.rentRatioResult || d.annualReturnResult || d.suggestPrice) {
      section('💡', '增值分析')
      kv('租金回报率', d.rentRatioResult)
      kv('年化收益率', d.annualReturnResult)
      kv('建议成交价', d.suggestPrice ? d.suggestPrice + '万元' : '')
      kv('议价空间', d.discountRate ? d.discountRate + '%' : '')
      hLine()
    }
  }

  // ========== 综合分析 ==========
  const analysis = []
  const avgP = Number(b.avgPrice || d.pricePerSqm || 0)
  const dealP = Number(d.salePrice || d.recentDealPrice || 0)
  const grade = d.grade || ''
  const gap = Number(d.gap || 0)
  const monthly = Number(d.monthly || 0)
  const income = Number((d.basic && d.basic.avgIncome) || 0)

  // 价格分析
  if (avgP && dealP) {
    const diff = ((dealP - avgP) / avgP * 100).toFixed(1)
    if (diff < -5) analysis.push('成交参考价低于区域均价' + Math.abs(diff) + '%，价格有优势')
    else if (diff > 5) analysis.push('成交参考价高于区域均价' + diff + '%，需关注溢价合理性')
    else analysis.push('成交参考价与区域均价基本持平')
  }

  // 性价比分析
  if (grade) {
    if (grade === 'A') analysis.push('性价比评级A档，综合表现优秀，值得重点考虑')
    else if (grade === 'B') analysis.push('性价比评级B档，基本合理，需关注配套兑现情况')
    else if (grade === 'C') analysis.push('性价比评级C档，存在一定溢价，建议谨慎评估')
    else if (grade === 'D') analysis.push('性价比评级D档，价格偏高，建议对比其他选择')
  }

  // 政策影响
  const localPol = policies.find(p => p.city === city)
  const nationalPol = policies.find(p => p.city === '全国')
  if (localPol) {
    if (localPol.purchase_limit) analysis.push('本地限购：' + localPol.purchase_limit + '，确认购房资格')
    if (localPol.down_payment) analysis.push('首付要求：' + localPol.down_payment + '，资金需提前准备')
    if (localPol.interest_rate) analysis.push('贷款利率：' + localPol.interest_rate)
  }
  if (nationalPol && nationalPol.summary) {
    analysis.push('全国政策趋势：' + nationalPol.summary)
  }

  // 小区品质
  if (com) {
    const sc = com.grade ? Number(com.grade.score) : 0
    if (sc >= 8) analysis.push('小区综合评分' + sc + '分，品质优秀，居住体验好')
    else if (sc >= 6) analysis.push('小区综合评分' + sc + '分，品质中等，基本满足居住需求')
    else if (sc > 0) analysis.push('小区综合评分' + sc + '分，品质一般，建议实地考察')
  }

  // 融资风险
  if (d.ageRisk) analysis.push('⚠️ 存在融资受限风险（楼龄+贷款年限>70），建议缩短贷款年限或选择其他标的')
  if (monthly > 0) analysis.push('月供' + monthly + '元，建议月供不超过家庭月收入50%')

  // 税费成本
  if (d.totalTax) {
    const taxRatio = (Number(d.totalTax) / (Number(d.salePriceC || 0) * 10000) * 100).toFixed(1)
    if (taxRatio > 5) analysis.push('税费占总价' + taxRatio + '%，成本较高，可关注满五唯一等减免政策')
    else analysis.push('税费占比' + taxRatio + '%，在合理范围内')
  }

  // 投资分析
  if (d.purpose && d.purpose.includes('投资')) {
    if (d.rentRatioResult) {
      const rr = parseFloat(d.rentRatioResult)
      if (rr >= 3) analysis.push('租金回报率' + d.rentRatioResult + '，投资回报可观')
      else analysis.push('租金回报率' + d.rentRatioResult + '，低于3%需谨慎考虑投资价值')
    }
  }

  // 风险提示总结
  if (risks.length) {
    analysis.push('已勾选' + risks.length + '项风险因素，建议重点关注：' + risks.map(r => r.name).join('、'))
  }

  if (analysis.length) {
    section('📊', '综合分析')
    analysisBlock('基于以上数据的综合评估', analysis)
    hLine()
  }

  // 底部
  y += 16 * px
  setColor('#94a3b8'); setFont(9); align('center'); base()
  ctx.fillText('本报告由「购房指南」智能评估系统自动生成，仅供参考', w / 2, y)
  y += 14 * px
  ctx.fillText('数据来源：安居客、贝壳、云数据库  |  ' + ds, w / 2, y)

  return y + 30 * px
}

function draw(d) {
  return new Promise((resolve) => {
    const query = wx.createSelectorQuery()
    query.select('#reportCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          resolve({ ok: false, error: 'no canvas' }); return
        }
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio || 2
        const w = res[0].width
        const cw = w * dpr
        canvas.width = cw
        const totalH = drawReport(ctx, d, cw)
        canvas.height = totalH
        ctx.scale(dpr, dpr)
        drawReport(ctx, d, w)
        setTimeout(() => {
          wx.canvasToTempFilePath({
            canvas, x: 0, y: 0, width: cw, height: totalH,
            destWidth: cw, destHeight: totalH, fileType: 'png',
            success: (r) => resolve({ ok: true, path: r.tempFilePath }),
            fail: () => resolve({ ok: false, error: '导出图片失败' })
          })
        }, 300)
      })
  })
}

function save(filePath) {
  return new Promise((resolve) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve({ ok: true }),
      fail: (e) => {
        if (e.errMsg && e.errMsg.includes('auth deny')) resolve({ ok: false, error: 'need_auth' })
        else resolve({ ok: false, error: '保存失败' })
      }
    })
  })
}

module.exports = { draw, save }
