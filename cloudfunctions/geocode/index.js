const https = require('https')

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'house-guide/1.0' } }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(8000, () => req.destroy())
  })
}

function normalize(name) {
  if (!name) return ''
  return String(name).replace(/市$/, '')
}

exports.main = async (event) => {
  const lat = Number(event.lat)
  const lng = Number(event.lng)
  if (!lat || !lng) return { city: '', source: '' }

  const key = process.env.TENCENT_MAP_KEY || ''
  if (key) {
    try {
      const d = await getJson('https://apis.map.qq.com/ws/geocoder/v1/?location=' + lat + ',' + lng + '&key=' + key)
      if (d && d.status === 0 && d.result) {
        const city = normalize(d.result.address_component.city)
        if (city) return { city, source: 'tencent' }
      }
    } catch (e) {}
  }

  try {
    const d = await getJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng + '&accept-language=zh')
    const a = (d && d.address) || {}
    const city = normalize(a.city || a.town || a.county || a.state_district || '')
    if (city) return { city, source: 'nominatim' }
  } catch (e) {}

  return { city: '', source: '' }
}
