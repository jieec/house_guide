const app = getApp()
const CITY_LIST = require('../../utils/cities.js')
const regionData = require('../../utils/region.js')

const CITIES = []
for (const p of regionData) {
  for (const c of p.cities) {
    const n = String(c.name).replace(/市$/, '')
    if (CITIES.indexOf(n) === -1) CITIES.push(n)
  }
}
const DEFAULT_CITY = '珠海'
const DEFAULT_INDEX = Math.max(0, CITIES.indexOf(DEFAULT_CITY))
const LIST_CACHE = {}
const CACHE_TTL = 30000

Page({
  data: {
    cities: CITIES,
    cityIndex: DEFAULT_INDEX,
    types: [
      { key: '', name: '全部' },
      { key: '二手房', name: '二手房' },
      { key: '租房', name: '租房' },
      { key: '新房', name: '新房' }
    ],
    typeIndex: 0,
    keyword: '',
    communitiesAll: [],
    communities: [],
    newHouses: [],
    newPage: 0,
    newHasMore: true,
    loading: false,
    locating: false,
    cloudOk: true,
    fromCommDb: false,
    showCityPanel: false,
    citySearch: '',
    cityFiltered: []
  },

  onShow() {
    const loc = app.globalData.location
    if (loc && loc.city) {
      const norm = String(loc.city).replace(/市$/, '')
      const i = this.data.cities.indexOf(norm)
      if (i >= 0) {
        this.setData({ cityIndex: i })
      }
    }
    this.reload()
  },

  onReachBottom() {
    const type = this.data.types[this.data.typeIndex].key
    if (type === '新房') {
      this.loadNewHouses(false)
    }
  },

  openCityPanel() {
    this.setData({ showCityPanel: true, citySearch: '' })
    this.buildCityFiltered('')
  },

  closeCityPanel() {
    this.setData({ showCityPanel: false })
  },

  onCitySearch(e) {
    const kw = e.detail.value
    this.setData({ citySearch: kw })
    this.buildCityFiltered(kw)
  },

  clearCitySearch() {
    this.setData({ citySearch: '' })
    this.buildCityFiltered('')
  },

  buildCityFiltered(kw) {
    const list = this.data.cities
      .map((name, idx) => ({ name, idx }))
      .filter(x => !kw || x.name.indexOf(kw) >= 0)
    this.setData({ cityFiltered: list })
  },

  pickCity(e) {
    const idx = e.currentTarget.dataset.idx
    this.setData({ cityIndex: idx, showCityPanel: false, keyword: '' })
    app.setCity(this.data.cities[idx])
    this.reload()
  },

  locateMe() {
    if (this.data.locating) return
    this.setData({ locating: true })
    const self = this
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        self.setData({ locating: false })
        let best = null
        let minD = Infinity
        for (const c of CITY_LIST) {
          const d = (c.lat - res.latitude) * (c.lat - res.latitude) + (c.lng - res.longitude) * (c.lng - res.longitude)
          if (d < minD) {
            minD = d
            best = c
          }
        }
        const distKm = Math.sqrt(minD) * 111
        if (best && distKm < 300) {
          const norm = String(best.name).replace(/市$/, '')
          const i = self.data.cities.indexOf(norm)
          if (i >= 0) {
            self.setData({ cityIndex: i, keyword: '' })
            app.setCity(norm)
            wx.showToast({ title: '已定位到 ' + best.name, icon: 'success' })
            self.reload()
          } else {
            wx.showToast({ title: best.name + ' 暂未收录', icon: 'none' })
          }
        } else {
          wx.showToast({ title: '当前位置超出覆盖范围', icon: 'none' })
        }
      },
      fail() {
        self.setData({ locating: false })
        wx.showToast({ title: '未授权定位，请手动选择城市', icon: 'none' })
      }
    })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: e.currentTarget.dataset.index, keyword: '' })
    this.reload()
  },

  onKeyword(e) {
    const kw = e.detail.value
    this.setData({ keyword: kw })
    const all = this.data.communitiesAll
    this.setData({ communities: kw ? all.filter(c => c._id.indexOf(kw) >= 0) : all })
  },

  reload() {
    const city = this.data.cities[this.data.cityIndex]
    const type = this.data.types[this.data.typeIndex].key
    if (type === '新房') {
      this.loadNewHouses(true)
    } else {
      this.loadCommunities(city, type)
    }
  },

  loadCommunities(city, type) {
    if (!wx.cloud) {
      this.setData({ cloudOk: false, loading: false })
      return
    }
    const cacheKey = city + '|' + type
    const cached = LIST_CACHE[cacheKey]
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      this.setData({ ...cached.data, loading: false })
      return
    }
    if (this.data.loading) return
    const db = wx.cloud.database()
    const $ = db.command.aggregate
    const match = { city, community: db.command.neq('') }
    if (type) match.category = type
    this.setData({ loading: true })
    db.collection('houses').aggregate()
      .match(match)
      .group({ _id: '$community', count: $.sum(1) })
      .sort({ count: -1 })
      .limit(500)
      .end()
      .then(res => {
        const list = (res.list || []).filter(c => c._id && c._id.trim())
        if (list.length === 0) {
          return db.collection('communities').where({ city }).limit(500).get().then(r2 => {
            const clist = (r2.data || []).map(c => ({
              _id: c.community,
              count: 0,
              summary: c.summary || '',
              score: (c.grade && c.grade.score) || ''
            }))
            return { fallback: true, list: clist }
          }).catch(() => ({ fallback: true, list: [] }))
        }
        return { fallback: false, list }
      })
      .then(r => {
        const nextData = {
          communitiesAll: r.list,
          communities: r.list,
          cloudOk: true,
          fromCommDb: !!r.fallback
        }
        LIST_CACHE[cacheKey] = { time: Date.now(), data: nextData }
        this.setData({ ...nextData, loading: false })
      })
      .catch(() => {
        this.setData({ loading: false, cloudOk: false })
      })
  },

  loadNewHouses(reset) {
    if (!wx.cloud) return
    if (this.data.loading) return
    if (!reset && !this.data.newHasMore) return
    const db = wx.cloud.database()
    const city = this.data.cities[this.data.cityIndex]
    const page = reset ? 0 : this.data.newPage
    this.setData({ loading: true })
    db.collection('houses').where({ city, category: '新房' })
      .orderBy('created_at', 'desc')
      .skip(page * 20).limit(20)
      .get()
      .then(res => {
        const arr = res.data || []
        this.setData({
          newHouses: reset ? arr : this.data.newHouses.concat(arr),
          newPage: page + 1,
          newHasMore: arr.length === 20,
          loading: false
        })
      })
      .catch(() => this.setData({ loading: false }))
  },

  goCommunity(e) {
    const name = e.currentTarget.dataset.name
    const city = this.data.cities[this.data.cityIndex]
    const type = this.data.types[this.data.typeIndex].key
    wx.navigateTo({
      url: '/pages/houses/community/community?city=' + encodeURIComponent(city) +
        '&name=' + encodeURIComponent(name) +
        '&type=' + encodeURIComponent(type || '')
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/houses/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goAnalyze(e) {
    wx.navigateTo({ url: '/pages/houses/analyze/analyze?id=' + e.currentTarget.dataset.id })
  }
})
