function getCommDoc(city, community) {
  return new Promise((resolve) => {
    if (!wx.cloud || !community) {
      resolve(null)
      return
    }
    const norm = city ? String(city).replace(/市$/, '') : ''
    const db = wx.cloud.database()
    const tryQuery = (q) => db.collection('communities').where(q).limit(1).get()
    const q1 = norm ? { city: norm, community } : { community }
    tryQuery(q1).then(res => {
      if (res.data && res.data.length) {
        resolve(res.data[0])
      } else {
        tryQuery({ community }).then(res2 => {
          resolve((res2.data && res2.data.length) ? res2.data[0] : null)
        }).catch(() => resolve(null))
      }
    }).catch(() => resolve(null))
  })
}

function getRentAvg(city, community) {
  return new Promise((resolve) => {
    if (!wx.cloud || !city || !community) {
      resolve('')
      return
    }
    const norm = String(city).replace(/市$/, '')
    const db = wx.cloud.database()
    const $ = db.command.aggregate
    db.collection('houses').aggregate()
      .match({ city: norm, community, category: '租房' })
      .group({
        _id: null,
        total: $.sum('$rent_month'),
        count: $.sum(1),
        avgArea: $.avg('$area_sqm')
      })
      .end()
      .then(res => {
        const g = (res.list && res.list[0]) || {}
        if (g.count && g.avgArea && g.avgArea > 0) {
          resolve((g.total / g.count / g.avgArea).toFixed(1))
        } else {
          resolve('')
        }
      })
      .catch(() => resolve(''))
  })
}

function cleanText(s) {
  if (!s) return ''
  return String(s)
    .replace(/米米/g, '米')
    .replace(/约约/g, '约')
    .replace(/约(\d+(?:\.\d+)?)米/g, '约$1米')
    .replace(/(\d+)米米/g, '$1米')
    .trim()
}

function summarySection(summary, label) {
  if (!summary) return ''
  const parts = String(summary).split('；')
  for (const p of parts) {
    if (p.indexOf(label) === 0) {
      return cleanText(p.replace(label + '：', '').trim())
    }
  }
  return ''
}

function normDist(d) {
  if (d === null || d === undefined || d === '') return ''
  const s = String(d).trim()
  const m = s.match(/[\d.]+/)
  if (!m) return ''
  let n = parseFloat(m[0])
  if (s.indexOf('公里') >= 0 || /km/i.test(s)) n *= 1000
  return String(Math.round(n))
}

function poisToText(pois, keys, limit) {
  const parts = []
  for (const k of keys) {
    const items = (pois && pois[k]) || []
    for (const it of items.slice(0, limit || 3)) {
      const n = cleanText(it.name || it.title || '')
      if (n) {
        const d = normDist(it.dist)
        parts.push(n + (d && d !== '0' ? ' 约' + d + '米' : ''))
      }
    }
  }
  return parts.join('、')
}

module.exports = { getCommDoc, getRentAvg, poisToText, summarySection, normDist, cleanText }
