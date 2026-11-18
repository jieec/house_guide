const { toValuationView } = require('../../utils/valuation-result.js')
Component({
  properties: { report: { type: Object, value: null }, loading: { type: Boolean, value: false }, error: { type: String, value: '' } },
  data: { view: null },
  observers: { report(report) { this.setData({ view: toValuationView(report) }) } },
  methods: { retry() { this.triggerEvent('retry') } }
})
