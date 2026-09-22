const app = getApp()
const reportExport = require('../../utils/report-export.js')
const cf = require('../../utils/commfetch.js')

Page({
  data: {
    keyword: '',
    searching: false,
    searchResults: [],
    city: '',
    communityName: '',
    autoFilled: false,
    fillNote: '',
    form: {
      areaRank: '',
      traffic: '',
      school: '',
      competitors: '',
      avgPrice: '',
      recentDealPrice: '',
      recentDealVolume: '',
      historyPrice: '',
      historyDealCount: '',
      age: '',
      tax: '',
      area: ''
    }
  },
  onShow() {
    const saved = wx.getStorageSync('basic')
    if (saved) {
      this.setData({ form: saved })
    }
    const loc = app.globalData.location
    if (loc && loc.city) {
      const city = String(loc.city).replace(/市$/, '')
      this.setData({ city })
      if (loc.community && !this.data.autoFilled) {
        this.autoFill(loc.community)
      }
    }
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },
  onKeyword(e) {
    const kw = e.detail.value
    this.setData({ keyword: kw })
    if (!kw) {
      this.setData({ searchResults: [] })
      return
    }
    if (!this.data.city) {
      wx.showToast({ title: '请先在首页设置定位', icon: 'none' })
      return
    }
    const db = wx.cloud.database()
    this.setData({ searching: true })
    db.collection('communities')
      .where({ city: this.data.city, community: db.RegExp({ regexp: kw, options: 'i' }) })
      .limit(10)
      .get()
      .then(res => this.setData({ searchResults: res.data || [], searching: false }))
      .catch(() => this.setData({ searchResults: [], searching: false }))
  },
  pickCommunity(e) {
    const name = e.currentTarget.dataset.name
    this.setData({ keyword: name, searchResults: [] })
    this.autoFill(name)
  },
  autoFill(name) {
    const city = this.data.city
    if (!city) {
      wx.showToast({ title: '请先在首页设置定位', icon: 'none' })
      return
    }
    this.setData({ communityName: name, autoFilled: false })
    const loc = app.globalData.location || {}
    Promise.all([cf.getCommDoc(city, name), this.getListStats(city, name)]).then(([doc, stats]) => {
      const f = { ...this.data.form }
      let filled = false
      if (doc) {
        filled = true
        const base = doc.base || {}
        const price = doc.price || {}
        const pois = doc.pois || {}
        if (loc.district) f.areaRank = loc.district
        f.traffic = cf.poisToText(pois, ['subway', 'bus'], 5)
        f.school = cf.poisToText(pois, ['school'], 5)
        const near = doc.nearComms || []
        f.competitors = near.map(n => `${n.name}(${n.price ? n.price + '元/㎡' : ''}${n.dist ? '，约' + cf.normDist(n.dist) + '米' : ''})`).join('、')
        if (price.price) {
          f.avgPrice = price.price
          f.historyPrice = f.historyPrice || price.price
        }
        if (base.completionTime) {
          const y = parseInt(base.completionTime, 10)
          if (y) f.age = String(new Date().getFullYear() - y)
        }
      }
      if (stats.count) {
        filled = true
        f.recentDealVolume = String(stats.count)
        f.historyDealCount = String(stats.count)
        if (stats.minPrice) f.recentDealPrice = stats.minPrice
        if (stats.avgArea) {
          f.area = String(Math.round(stats.avgArea))
          if (f.avgPrice) f.tax = String(Math.round(Number(f.avgPrice) * stats.avgArea * 0.01))
        }
      }
      this.setData({
        form: f,
        autoFilled: filled,
        fillNote: filled ? (doc ? '安居客小区数据 + 房源库统计' : '房源库统计') : '云端暂无该小区数据'
      })
      if (!filled) {
        wx.showToast({ title: '云端暂无该小区数据，请手动填写', icon: 'none' })
      }
    })
  },
  getListStats(city, name) {
    const db = wx.cloud.database()
    const countP = db.collection('houses')
      .where({ city, community: name, category: '二手房' })
      .count()
      .then(res => res.total || 0)
      .catch(() => 0)
    const listP = db.collection('houses')
      .where({ city, community: name, category: '二手房' })
      .limit(20)
      .get()
      .then(res => {
        const list = res.data || []
        let minPrice = 0
        let sumArea = 0
        let n = 0
        for (const it of list) {
          const up = parseFloat(it.unit_price)
          const ar = parseFloat(it.area_sqm)
          if (up && (!minPrice || up < minPrice)) minPrice = up
          if (ar) {
            sumArea += ar
            n++
          }
        }
        return { minPrice: minPrice ? String(Math.round(minPrice)) : '', avgArea: n ? sumArea / n : 0 }
      })
      .catch(() => ({ minPrice: '', avgArea: 0 }))
    return Promise.all([countP, listP]).then(([count, st]) => ({ count, ...st }))
  },
  exportPdf() {
    reportExport.exportReport(this)
  },
  save() {
    wx.setStorageSync('basic', this.data.form)
    wx.showToast({ title: '已保存', icon: 'success' })
  }
})
