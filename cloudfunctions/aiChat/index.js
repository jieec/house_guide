// 云函数：aiChat —— DeepSeek 房产智能专家
// 环境变量：DEEPSEEK_KEY（必填）
// 后台配置：数据库集合 ai_config（文档 main）、ai_knowledge（知识条目）
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_PROMPT = '你是一个房产数据解读助手，任务是根据给定小区数据算出评估价，并把价格高低和下一步怎么做讲清楚。说话平实、直接、客观，不推销，不扮演顾问。回答只写两段，全文控制在 300 字以内。'
const DEFAULT_STYLE = [
  '用现代白话平实陈述，像普通朋友聊天一样直说，不要写成报告或AI回答。',
  '不要顾问口吻：不要自称“我建议你”“听我的”“照做就行”，不推销、不制造紧迫感、不替用户拍板。',
  '用现代白话口语，不要用文言文、古风、诗词，也不要用“此盘、乃、颇为、实属、堪称、尚可”这类书面腔。',
  '不要使用编号列表、项目符号、加粗、标题、表格等 Markdown 格式；只写两段自然段落。',
  '不要出现"作为AI""根据您提供的数据""综上所述"等套话；不要复述问题。',
  '第一段第一句必须直接给出系统评估价，写成“评估价约 X 元/㎡”或“X 万/㎡”，不能省略，也不能只给区间。',
  '第二段给出明确判断和下一步动作：值得入手、可以压价、建议观望或谨慎，说明依据，但不要用顾问式推销口气。',
  '若数据里有工抵参考价，只用一句话点明它和评估价的差距，作为谈判参考；没有就不要提。',
  '不要展开税费、贷款、学区等次要信息，除非用户明确追问。',
  '数字只使用给定数据，缺失就直说；不要编造政策或价格。',
  '全文严格控制在 180~300 个汉字（含标点），超过 300 字视为不合格，最后用一句话总结。'
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

// 兜底：确保回答里出现评估价和明确建议
function charCount(text) {
  return String(text || '').replace(/\s/g, '').length
}

function ensureRequired(text, evaluation) {
  let out = String(text || '').trim()
  const n = Math.round(Number(evaluation) || 0)
  if (n > 0) {
    const flat = out.replace(/[,\s]/g, '')
    const wan = (n / 10000).toFixed(1) + '万'
    const hundred = String(Math.round(n / 100) * 100)
    const hasPrice = flat.indexOf(String(n)) >= 0 || flat.indexOf(wan) >= 0 || flat.indexOf(hundred) >= 0
    if (!hasPrice) out = '评估价约 ' + n + ' 元/㎡。' + out
  }
  if (!/建议|值得|观望|谨慎|入手|压价/.test(out)) {
    out = out.replace(/\s*$/, '') + ' 建议结合预算和持有周期谨慎决策。'
  }
  return out
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
    return list.slice(0, 3)
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

  const basicRows = Array.isArray(context.basic) ? context.basic.slice(0, 8) : []
  const priceRows = Array.isArray(context.priceDetails) ? context.priceDetails.slice(0, 6) : []
  const communityName = (doc && doc.community) || context.community || ''
  const knowledge = await loadKnowledge(city, communityName + ' ' + (question || ''))

  const dataText = [
    '小区：' + communityName + '（' + [doc && doc.city, doc && doc.district].filter(Boolean).join(' ') + '）',
    '系统综合评估价：' + fmt(context.evaluation, ' 元/㎡') + '（回答必须使用这个数字）',
    '评估价相对挂牌价：' + fmt(context.evalDeviation),
    '评估价与工抵参考价差距：' + fmt(context.evalVsGongdiText) + (context.evalVsGongdiText ? '（正数=评估价高于工抵价，即折扣空间）' : ''),
    '市场比较法估值：' + fmt(context.marketValue, ' 元/㎡'),
    '收益还原法估值：' + fmt(context.incomeValue, ' 元/㎡') + (ref.beian_price ? '（仅参考，未计入有备案价项目的评估价）' : ''),
    '贝壳参考均价：' + fmt(bk.avg_price, ' 元/㎡'),
    '近期成交均价：' + fmt(deals.avg_unit_price, ' 元/㎡') + '（' + fmt(deals.count, ' 笔') + '，最近 ' + fmt(deals.latest_date) + '）',
    '挂牌均价：' + fmt(price.listingPrice || context.listingAvg, ' 元/㎡'),
    '租金：' + fmt(rentals.avg_unit_rent || price.rentPerSqm || context.rentAvg, ' 元/㎡/月'),
    '挂牌率：' + (bk.listing_rate ? (Number(bk.listing_rate) * 100).toFixed(1) + '%' : '暂无数据'),
    '备案价参考：' + (ref.beian_price ? fmt(ref.beian_price, ' 元/㎡') + '（工抵价 ' + fmt(ref.gongdi_price, ' 元/㎡') + '，' + fmt(ref.units, ' 套') + '）' : '暂无'),
    '工抵参考价（备案价×折扣）：' + (context.gongdiValue ? fmt(context.gongdiValue, ' 元/㎡') + '（折扣 ' + (context.gongdiRate ? (Number(context.gongdiRate) * 100).toFixed(1) + '%' : '暂缺') + '）' : '暂无'),
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
    { role: 'user', content: question || '请先给出这个小区的系统评估价，再给出明确的购房建议。' }
  ]

  try {
    const r = await postJSON('https://api.deepseek.com/chat/completions', {
      'Authorization': 'Bearer ' + key
    }, {
      model: 'deepseek-chat',
      messages,
      temperature: 0.6,
      max_tokens: 600
    })

    if (r.status !== 200 || !r.json || !r.json.choices) {
      const msg = (r.json && (r.json.error && r.json.error.message)) || r.raw || ('HTTP ' + r.status)
      return { ok: false, error: String(msg).slice(0, 300) }
    }
    let content = (r.json.choices[0].message.content || '').trim()
    // 超长时二次压缩，确保 180~300 字，同时保留评估价、建议和结论
    if (charCount(content) > 330) {
      try {
        const r2 = await postJSON('https://api.deepseek.com/chat/completions', {
          'Authorization': 'Bearer ' + key
        }, {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是文字编辑。把下面的分析压缩成 180~300 个汉字（含标点），只保留两段：第一段第一句必须保留评估价数字和核心依据，第二段保留明确判断、下一步动作和最后结论。删除税费、贷款、学区等次要信息，不要用列表、标题或 Markdown，保持平实口吻，直接输出正文。' },
            { role: 'user', content }
          ],
          temperature: 0.3,
          max_tokens: 500
        }, 30000)
        if (r2.status === 200 && r2.json && r2.json.choices) {
          const shorter = (r2.json.choices[0].message.content || '').trim()
          if (shorter && charCount(shorter) >= 120) content = shorter
        }
      } catch (e) {
        // 压缩失败则保留原文
      }
    }
    return {
      ok: true,
      content: ensureRequired(content, context.evaluation),
      usage: r.json.usage || null,
      knowledgeUsed: knowledge.map(k => k.title || '')
    }
  } catch (e) {
    return { ok: false, error: '调用 DeepSeek 失败：' + (e.message || e) }
  }
}
