function num(s) {
  const m = String(s || '').match(/[\d.]+/)
  return m ? parseFloat(m[0]) : null
}

function getCommunity(db, city, name) {
  return db.collection('communities')
    .where({ city, community: name })
    .limit(1)
    .get()
    .then(res => (res.data && res.data.length ? res.data[0] : null))
}

function getHouseStats(db, city, community) {
  const tasks = []
  tasks.push(
    db.collection('houses').where({ city, community, category: '二手房' })
      .orderBy('created_at', 'desc').limit(20).get().then(r => r.data || [])
  )
  tasks.push(
    db.collection('houses').where({ city, community, category: '租房' })
      .orderBy('created_at', 'desc').limit(20).get().then(r => r.data || [])
  )
  tasks.push(
    db.collection('houses').where({ city, community }).count()
  )
  return Promise.all(tasks).then(results => {
    const sales = results[0]
    const rents = results[1]
    const total = results[2] ? results[2].total : 0
    const units = []
    const areas = []
    for (const h of sales) {
      const u = num(h.unit_price)
      const a = num(h.area_sqm)
      if (u) units.push(u)
      if (a) areas.push(a)
    }
    const rentPerSqm = []
    for (const r of rents) {
      const rent = num(r.rent_month)
      const a = num(r.area_sqm)
      if (rent && a && a > 0) rentPerSqm.push(rent / a)
    }
    const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null)
    return {
      total,
      saleCount: sales.length,
      rentCount: rents.length,
      avgUnit: avg(units),
      minUnit: units.length ? Math.min.apply(null, units) : null,
      maxUnit: units.length ? Math.max.apply(null, units) : null,
      avgArea: avg(areas),
      rentPerSqm: avg(rentPerSqm),
      sampleCount: units.length
    }
  })
}

function buildSummary(comm, stats) {
  const lines = []
  if (comm && comm.summary) return comm.summary
  if (stats && stats.avgUnit) lines.push('挂牌均价约' + Math.round(stats.avgUnit) + '元/㎡')
  if (stats && stats.rentPerSqm) lines.push('租金约' + stats.rentPerSqm.toFixed(1) + '元/㎡/月')
  return lines.join('；')
}

function poiText(comm, keys, limit) {
  const pois = (comm && comm.pois) || {}
  const parts = []
  for (const k of keys) {
    const items = (pois[k] || []).slice(0, limit || 2)
    for (const it of items) {
      if (it && it.title) parts.push(it.title + (it.dist ? ' ' + it.dist : ''))
    }
  }
  return parts.join('、')
}

module.exports = {
  num,
  getCommunity,
  getHouseStats,
  buildSummary,
  poiText
}
