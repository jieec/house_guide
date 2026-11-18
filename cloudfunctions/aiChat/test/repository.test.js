const test = require('node:test')
const assert = require('node:assert/strict')
const { createRepository, reportId, digest, canonical } = require('../lib/repository')
const { memoryDb } = require('./helpers/memory-db')

test('atomic reserve is owner-scoped and canonical hashing ignores object key order', async () => {
  assert.equal(digest(canonical({ a: 1, b: 2 })), digest(canonical({ b: 2, a: 1 })))
  assert.notEqual(reportId('a', 'same'), reportId('b', 'same'))
  const db = memoryDb()
  const repo = createRepository(db)
  const request = { requestId: '1', targetType: 'community', communityId: 'c1' }
  const [a, b] = await Promise.all([repo.reserve('owner', request, new Date(), 1000), repo.reserve('owner', request, new Date(), 1000)])
  assert.equal(Number(a.created) + Number(b.created), 1)
  assert.equal(db.records.valuation_reports.length, 1)
})

test('zero-updated persistence receipts never count as a saved report', async () => {
  for (const result of [{ stats: { updated: 0 } }, { updated: 0 }, {}]) {
    const db = { collection: () => ({ doc: () => ({ update: async () => result }) }) }
    await assert.rejects(createRepository(db).finish('id', {}), { code: 'REPORT_WRITE_FAILED' })
  }
})

test('get distinguishes absent reports from permission/query failures', async () => {
  const db = memoryDb()
  assert.equal(await createRepository(db).get('absent'), null)
  const broken = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('permission denied') } }) }) }
  await assert.rejects(createRepository(broken).get('id'), { code: 'REPORT_READ_FAILED' })
})
