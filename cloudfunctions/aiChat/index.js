// 云函数：aiChat —— 调用 DeepSeek 生成小区评估价与购房建议
// 环境变量：DEEPSEEK_KEY（必填，DeepSeek 开放平台的 API Key）
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function postJSON(url, headers, bodyObj, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj)
    const req = https.request(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers),
      timeout: timeoutMs
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data), raw: data })
        } catch (e) {
          resolve({ status: res.statusCode, json: null, raw: data })
        }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function fmt(v, suffix) {
  return (v === undefined || v === null || v === '') ? '暂无数据' : String(v) + (suffix || '')
}

exports.main = async (event) => {
  const key = process.env.DEEPSEEK_KEY
  if (!key) {
    return { ok: false, error: '云函数未配置 DEEPSEEK_KEY 环境变量' }
  }

  const { communityId = '', question = '', context = {} } = event || {}

  // 服务端补全小区数据（以数据库为准，客户端数据只作兜底）
  let doc = null
  if (communityId) {
    try {
      const res = await db.collection('communities').doc(communityId).get()
      doc = res.data || null
    } catch (e) {
      doc = null
    }
  }
  const bk = (doc && doc.beike) || {}
  const deals = (doc && doc.deals) || {}
  const rentals = (doc && doc.rentals) || {}
  const ref = (doc && doc.reference) || {}
  const price = (doc && doc.price) || {}

  const basicRows = Array.isArray(context.basic) ? context.basic.slice(0, 14) : []
  const priceRows = Array.isArray(context.priceDetails) ? context.priceDetails.slice(0, 10) : []

  const dataText = [
    '小区：' + (doc ? doc.community : context.community || '') + '（' + [doc && doc.city, doc && doc.district].filter(Boolean).join(' ') + '）',
    '贝壳参考均价：' + fmt(bk.avg_price, ' 元/㎡'),
    '市场比较法估值：' + fmt(context.marketValue, ' 元/㎡'),
    '收益还原法估值：' + fmt(context.incomeValue, ' 元/㎡'),
    '系统综合评估价：' + fmt(context.evaluation, ' 元/㎡'),
    '近期成交均价：' + fmt(deals.avg_unit_price, ' 元/㎡') + '（' + fmt(deals.count, ' 笔') + '，最近 ' + fmt(deals.latest_date) + '）',
    '挂牌均价：' + fmt(price.listingPrice || context.listingAvg, ' 元/㎡'),
    '租金：' + fmt(rentals.avg_unit_rent || price.rentPerSqm, ' 元/㎡/月'),
    '挂牌率：' + (bk.listing_rate ? (Number(bk.listing_rate) * 100).toFixed(1) + '%' : '暂无数据'),
    '备案价参考：' + (ref.beian_price ? fmt(ref.beian_price, ' 元/㎡') + '（工抵价 ' + fmt(ref.gongdi_price, ' 元/㎡') + '，' + fmt(ref.units, ' 套') + '）' : '暂无'),
    basicRows.length ? '小区档案：' + basicRows.map(x => x.label + '=' + x.value).join('；') : '',
    priceRows.length ? '价格指标：' + priceRows.map(x => x.label + '=' + x.value).join('；') : ''
  ].filter(Boolean).join('\n')

  const system = [
    '你是"购房指南"小程序的房产评估助手。基于给定的小区数据，给出评估价与购房建议。',
    '评估方法说明：市场比较法参考贝壳均价、近期成交价、挂牌均价加权；收益还原法 = 年有效租金 ÷ 资本化率。',
    '',
    '【小区数据】',
    dataText,
    '',
    '【输出要求】',
    '1. 第一行给出：评估价 = X 元/㎡，合理区间 X~X 元/㎡（区间约 ±5%~8%）',
    '2. 简述依据：市场比较法与收益还原法各自的结果和可信度；数据缺失或异常要明确指出',
    '3. 给出 3 条以内的购房建议（含风险提示）',
    '4. 不得编造数据；所有数字必须来自上方数据',
    '5. 总字数 200~350 字，分点作答，不要使用 Markdown 表格'
  ].join('\n')

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: question || '请给出该小区的评估价与购房建议。' }
  ]

  try {
    const r = await postJSON('https://api.deepseek.com/chat/completions', {
      'Authorization': 'Bearer ' + key
    }, {
      model: 'deepseek-chat',
      messages,
      temperature: 0.3,
      max_tokens: 900
    })

    if (r.status !== 200 || !r.json || !r.json.choices) {
      const msg = (r.json && (r.json.error && r.json.error.message)) || r.raw || ('HTTP ' + r.status)
      return { ok: false, error: String(msg).slice(0, 300) }
    }
    return {
      ok: true,
      content: (r.json.choices[0].message.content || '').trim(),
      usage: r.json.usage || null
    }
  } catch (e) {
    return { ok: false, error: '调用 DeepSeek 失败：' + (e.message || e) }
  }
}
