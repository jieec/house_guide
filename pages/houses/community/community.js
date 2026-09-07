
Page({
  data: {
    city: '',
    name: '',
    types: [
      { key: '', name: '全部' },
      { key: '二手房', name: '二手房' },
      { key: '租房', name: '租房' }
    ],
    typeIndex: 0,
    list: [],
    page: 0,
    hasMore: true,
    loading: false,
    total: 0,
    commInfo: null,
    showIntro: false,
    showAllPois: false
  },

  async onLoad(options) {
    const type = decodeURIComponent(options.type || '')
    let typeIndex = 0
    if (type === '二手房') typeIndex = 1
    if (type === '租房') typeIndex = 2
    this.setData({
      city: decodeURIComponent(options.city || ''),
      name: decodeURIComponent(options.name || ''),
      typeIndex
    })
    wx.setNavigationBarTitle({ title: this.data.name || '小区房源' })
    this.load(true)
    this.loadCommInfo()
  },

  loadCommInfo() {
    if (!wx.cloud || !this.data.city || !this.data.name) return
    const db = wx.cloud.database()
    db.collection('communities')
      .where({ city: this.data.city, community: this.data.name })
      .limit(1)
      .get()
      .then(res => {
        if (!res.data || !res.data.length) return
        const c = res.data[0]
        const pois = c.pois || {}
        const poiList = [
          { title: '公交', icon: '🚌', items: pois.bus || [] },
          { title: '地铁', icon: '🚇', items: pois.subway || [] },
          { title: '学校', icon: '🏫', items: pois.school || [] },
          { title: '医院', icon: '🏥', items: pois.hospital || [] },
          { title: '购物', icon: '🛍️', items: pois.buy || [] },
          { title: '餐饮', icon: '🍜', items: pois.restaurant || [] },
          { title: '银行', icon: '🏦', items: pois.bank || [] }
        ]
        const gradeItems = (c.grade && c.grade.list) || []
        const base = c.base || {}
        const price = c.price || {}
        this.setData({
          commInfo: {
            base,
            price,
            grade: c.grade || {},
            gradeItems,
            poiList,
            nearComms: c.nearComms || [],
            introduction: c.introduction || '',
            summary: c.summary || '',
            metroDesc: c.metroDesc || ''
          }
        })
      })
      .catch(() => {})
  },

  toggleIntro() {
    this.setData({ showIntro: !this.data.showIntro })
  },

  toggleAllPois() {
    this.setData({ showAllPois: !this.data.showAllPois })
  },

  onReachBottom() {
    this.load(false)
  },

  switchType(e) {
    this.setData({ typeIndex: e.currentTarget.dataset.index })
    this.load(true)
  },

  load(reset) {
    if (this.data.loading) return
    if (!reset && !this.data.hasMore) return
    if (!wx.cloud) return
    this.setData({ loading: true })
    const db = wx.cloud.database()
    const where = { city: this.data.city, community: this.data.name }
    const type = this.data.types[this.data.typeIndex].key
    if (type) where.category = type
    const page = reset ? 0 : this.data.page
    const self = this
    db.collection('houses').where(where)
      .orderBy('created_at', 'desc')
      .skip(page * 20).limit(20)
      .get()
      .then(res => {
        const arr = res.data || []
        const list = reset ? arr : self.data.list.concat(arr)
        self.setData({
          list,
          page: page + 1,
          hasMore: arr.length === 20,
          loading: false
        })
        return db.collection('houses').where(where).count()
      })
      .then(res => {
        if (res) self.setData({ total: res.total })
      })
      .catch(() => self.setData({ loading: false }))
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/houses/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goAnalyze(e) {
    wx.navigateTo({ url: '/pages/houses/analyze/analyze?id=' + e.currentTarget.dataset.id })
  }
})
