// Existing text requests remain compatible; structured valuations use explicit actions.
const cloud = require('wx-server-sdk')
const { createValuationService } = require('./lib/service')
const createLegacyHandler = require('./legacy')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const legacy = createLegacyHandler(db)
const service = createValuationService({ db })

exports.main = async (event) => {
  if (event && typeof event === 'object' && !Array.isArray(event) && event.action === undefined) {
    return legacy(event)
  }
  // WeChat attaches userInfo/tcbContext to events. These are transport metadata,
  // never an identity source or a business field in the strict request contract.
  let request = event
  if (event && typeof event === 'object' && !Array.isArray(event)) {
    const { userInfo, tcbContext, ...businessRequest } = event
    request = businessRequest
  }
  return service.handle(request, cloud.getWXContext().OPENID)
}
