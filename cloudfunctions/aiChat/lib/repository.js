const crypto = require('crypto')

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}
function reportId(owner, requestId) {
  return 'v_' + digest(owner + '\n' + requestId).slice(0, 30)
}
function isMissing(error) {
  return /DOCUMENT_(NOT_EXIST|NOT_FOUND)|document.*(not exist|not found)|文档不存在/i.test(String(error && (error.code || error.errCode || '')) + ' ' + String(error && (error.errMsg || error.message || '')))
}
function failure(code, message) {
  return Object.assign(new Error(message), { code })
}

function createRepository(db) {
  const collection = db.collection('valuation_reports')
  async function get(id) {
    try {
      const result = await collection.doc(id).get()
      return result.data || null
    } catch (error) {
      if (isMissing(error)) return null
      throw failure('REPORT_READ_FAILED', '评估记录读取失败')
    }
  }
  return {
    get,
    // Atomic primary-key insertion prevents duplicate model calls. set would overwrite.
    async reserve(owner, request, now, ttlMs) {
      const id = reportId(owner, request.requestId)
      const requestHash = digest(canonical(request))
      const row = {
        _id: id, owner, requestHash, status: 'processing',
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString()
      }
      try {
        await collection.add({ data: row })
        return { created: true, row }
      } catch (error) {
        const existing = await get(id)
        if (!existing) throw failure('REPORT_WRITE_FAILED', '无法创建评估记录，请检查数据库集合与权限')
        if (existing.owner !== owner || existing.requestHash !== requestHash) throw failure('REQUEST_ID_CONFLICT', '同一 requestId 不能用于不同的评估参数')
        return { created: false, row: existing }
      }
    },
    async finish(id, data) {
      try {
        const result = await collection.doc(id).update({ data })
        const updated = result && result.stats ? result.stats.updated : result && result.updated
        if (updated !== 1) throw failure('REPORT_WRITE_FAILED', '评估记录未更新')
      }
      catch (error) { throw failure('REPORT_WRITE_FAILED', '评估结果保存失败，请稍后按报告编号查询') }
    }
  }
}
module.exports = { createRepository, canonical, digest, reportId, isMissing }
