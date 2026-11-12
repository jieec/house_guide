// 云函数：aiChat —— DeepSeek 房产智能专家
// 环境变量：DEEPSEEK_KEY（必填）
// 后台配置：数据库集合 ai_config（文档 main）、ai_knowledge（知识条目）
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_PROMPT = '你是一位在粤港澳大湾区从业十年的二手房顾问，熟悉珠海、中山市场，擅长用通俗的话把价格逻辑讲清楚。你的任务是基于给定小区数据，给出评估价判断和购房建议。'
const DEFAULT_STYLE = [
  '以资深房产顾问的口吻写作，像面对面给朋友分析，不要写成报告或AI回答。',
  '不要使用编号列表、项目符号、加粗、标题、表格等 Markdown 格式；用自然段落，段间空一行。',
  '不要出现"作为AI""根据您提供的数据""综上所述"等套话；不要复述问题。',
  '数字只使用给定数据，缺失就直说；不要编造政策或价格。',
  '总字数控制在 180~300 字，最后用一句话给出明确结论（值得关注/建议观望/谨慎等）。'
].join('\n')

function postJSON(url, headers, bodyObj, timeoutMs = 55000) {
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

async function loadConfig() {
  try {
    const res = await db.collection('ai_config').doc('main').get()
    return res.data || {}
  } catch (e) {
    return {}
  }
}

async function loadKnowledge(city, keywordText) {
  try {
    const res = await db.collection('ai_knowledge').where({ enabled: true }).limit(30).get()
    let list = res.data || []
    list = list.filter(k => !k.city || k.city === '全国' || k.city === city)
    // 按关键词重合度排序，取最相关的 5 条
    const words = String(keywordText || '').split(/[\s,，。；;、]+/).filter(w => w.length >= 2)
    list.forEach(k => {
      const text = (k.title || '') + (k.content || '') + (k.tags || []).join('')
      k._score = words.reduce((s, w) => s + (text.indexOf(w) >= 0 ? 1 : 0), 0)
    })
    list.sort((a, b) => b._score - a._score)
    return list.slice(0, 5)
  } catch (e) {
    return []
  }
}

exports.main = async (event) => {
  const key = process.env.DEEPSEEK_KEY
  if (!key) {
    return { ok: false, error: '云函数未配置 DEEPSEEK_KEY 环境变量' }
  }

  const { communityId = '', question = '', context = {} } = event || {}

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
  const city = (doc && doc.city) || context.city || ''

  const cfg = await loadConfig()
  const basePrompt = cfg.system_prompt || DEFAULT_PROMPT
  const styleRules = cfg.style_rules || DEFAULT_STYLE

  const basicRows = Array.isArray(context.basic) ? context.basic.slice(0, 14) : []
  const priceRows = Array.isArray(context.priceDetails) ? context.priceDetails.slice(0, 10) : []
  const communityName = (doc && doc.community) || context.community || ''
  const knowledge = await loadKnowledge(city, communityName + ' ' + (question || ''))

  const dataText = [
    '小区：' + communityName + '（' + [doc && doc.city, doc && doc.district].filter(Boolean).join(' ') + '）',
    '贝壳参考均价：' + fmt(bk.avg_price, ' 元/㎡'),
    '市场比较法估值：' + fmt(context.marketValue, ' 元/㎡'),
    '收益还原法估值：' + fmt(context.incomeValue, ' 元/㎡'),
    '系统综合评估价：' + fmt(context.evaluation, ' 元/㎡'),
    '近期成交均价：' + fmt(deals.avg_unit_price, ' 元/㎡') + '（' + fmt(deals.count, ' 笔') + '，最近 ' + fmt(deals.latest_date) + '）',
    '挂牌均价：' + fmt(price.listingPrice || context.listingAvg, ' 元/㎡'),
    '租金：' + fmt(rentals.avg_unit_rent || price.rentPerSqm || context.rentAvg, ' 元/㎡/月'),
    '挂牌率：' + (bk.listing_rate ? (Number(bk.listing_rate) * 100).toFixed(1) + '%' : '暂无数据'),
    '备案价参考：' + (ref.beian_price ? fmt(ref.beian_price, ' 元/㎡') + '（工抵价 ' + fmt(ref.gongdi_price, ' 元/㎡') + '，' + fmt(ref.units, ' 套') + '）' : '暂无'),
    basicRows.length ? '小区档案：' + basicRows.map(x => x.label + '=' + x.value).join('；') : '',
    priceRows.length ? '价格指标：' + priceRows.map(x => x.label + '=' + x.value).join('；') : ''
  ].filter(Boolean).join('\n')

  const knowledgeText = knowledge.length
    ? knowledge.map(k => '【' + (k.title || '行业知识') + '】' + (k.content || '')).join('\n')
    : '（暂无额外行业知识）'

  const system = [
    basePrompt,
    '',
    '【写作要求】',
    styleRules,
    '',
    '【可参考的行业知识】',
    knowledgeText,
    '',
    '【当前小区数据】',
    dataText
  ].join('\n')

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: question || '请判断这个小区的合理价格，并给出购房建议。' }
  ]

  try {
    const r = await postJSON('https://api.deepseek.com/chat/completions', {
      'Authorization': 'Bearer ' + key
    }, {
      model: 'deepseek-chat',
      messages,
      temperature: 0.6,
      max_tokens: 800
    })

    if (r.status !== 200 || !r.json || !r.json.choices) {
      const msg = (r.json && (r.json.error && r.json.error.message)) || r.raw || ('HTTP ' + r.status)
      return { ok: false, error: String(msg).slice(0, 300) }
    }
    return {
      ok: true,
      content: (r.json.choices[0].message.content || '').trim(),
      usage: r.json.usage || null,
      knowledgeUsed: knowledge.map(k => k.title || '')
    }
  } catch (e) {
    return { ok: false, error: '调用 DeepSeek 失败：' + (e.message || e) }
  }
}
