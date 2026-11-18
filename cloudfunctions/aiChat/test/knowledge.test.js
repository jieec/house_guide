const test = require('node:test')
const assert = require('node:assert/strict')
const { loadKnowledge } = require('../lib/knowledge')

const NOW = new Date('2026-11-17T04:00:00.000Z')
function database(records, failure) {
  const calls = []
  return {
    calls, command: { exists: value => ({ $exists: value }) },
    collection(name) {
      assert.equal(name, 'ai_knowledge')
      return { where(filter) {
        const state = { filter, skip: 0, limit: 20 }
        const chain = {
          orderBy(field, direction) { assert.equal(field, '_id'); assert.equal(direction, 'asc'); return chain },
          skip(n) { state.skip = n; return chain },
          limit(n) { state.limit = n; return chain },
          async get() {
            calls.push({ ...state })
            if (failure) throw failure
            const applicable = records.filter(row => row.enabled === filter.enabled &&
              (filter.city && typeof filter.city === 'object' ? !Object.hasOwn(row, 'city') : row.city === filter.city))
              .sort((a, b) => a._id.localeCompare(b._id))
            return { data: applicable.slice(state.skip, state.skip + state.limit) }
          }
        }
        return chain
      } }
    }
  }
}

function entry(id, extras = {}) {
  return { _id: id, enabled: true, title: '市场评估', content: '使用近期成交实例比较市场价值。', sourceUrl: 'https://example.com/policy', version: 'v1', ...extras }
}

test('city filtering happens in the database and includes legacy nationwide entries', async () => {
  const db = database([
    ...Array.from({ length: 80 }, (_, i) => entry('other-' + i, { city: '其他城市' })),
    entry('local', { city: '珠海' }), entry('local-suffix', { city: '珠海市' }),
    entry('national', { city: '全国' }), entry('blank', { city: '' }), entry('legacy'), entry('null', { city: null })
  ])
  const result = await loadKnowledge(db, { city: '珠海市', propertyType: '住宅', now: NOW, limit: 6 })
  assert.deepEqual(result.items.map(v => v.id).sort(), ['blank', 'legacy', 'local', 'local-suffix', 'national', 'null'])
  assert.equal(db.calls.length, 6)
  assert.ok(db.calls.every(v => v.filter.enabled === true && Object.hasOwn(v.filter, 'city')))
  assert.match(result.version, /^knowledge-[a-f0-9]{16}$/)
})

test('expired, future, wrong asset type and unrelated topical entries are excluded', async () => {
  const db = database([
    entry('valid', { city: '全国', propertyType: '住宅', effectiveFrom: '2026-11-17', effectiveTo: '2026-11-17' }),
    entry('expired', { effectiveTo: '2026-11-16' }), entry('future', { effectiveFrom: '2026-11-18' }),
    entry('commercial', { propertyType: '商业' }), entry('disabled', { enabled: false }),
    entry('unrelated', { topic: '出国', title: '护照办理', content: '护照申请流程' }),
    entry('bad-date', { effectiveFrom: 'not-a-date' }), entry('impossible-date', { effectiveFrom: '2026-02-30' })
  ])
  const result = await loadKnowledge(db, { city: '珠海', propertyType: '普通住宅', now: NOW })
  assert.deepEqual(result.items.map(v => v.id), ['valid'])
  assert.ok(result.warnings.includes('KNOWLEDGE_DATE_INVALID:bad-date'))
  assert.ok(result.warnings.includes('KNOWLEDGE_DATE_INVALID:impossible-date'))
})

test('date-only validity uses China calendar boundaries', async () => {
  const records = [entry('policy', { effectiveFrom: '2026-11-17', effectiveTo: '2026-11-17' })]
  const before = await loadKnowledge(database(records), { now: '2026-11-16T15:59:59.999Z' })
  const start = await loadKnowledge(database(records), { now: '2026-11-16T16:00:00.000Z' })
  const end = await loadKnowledge(database(records), { now: '2026-11-17T15:59:59.999Z' })
  const after = await loadKnowledge(database(records), { now: '2026-11-17T16:00:00.000Z' })
  assert.equal(before.items.length, 0)
  assert.equal(start.items.length, 1)
  assert.equal(end.items.length, 1)
  assert.equal(after.items.length, 0)
})

test('knowledge retrieval paginates each city scope and marks bounded scans', async () => {
  const db = database(Array.from({ length: 205 }, (_, i) => entry('k' + String(i).padStart(3, '0'), { city: '珠海' })))
  const result = await loadKnowledge(db, { city: '珠海', now: NOW })
  assert.equal(db.calls.filter(v => v.filter.city === '珠海').length, 4)
  assert.equal(result.items.length, 5)
  assert.ok(result.warnings.includes('KNOWLEDGE_SCOPE_TRUNCATED:珠海'))
})

test('text budgets and absent sources are visible; selected content controls version', async () => {
  const records = Array.from({ length: 10 }, (_, i) => entry('long-' + i, { content: '估价'.repeat(1500), sourceUrl: '', source: '' }))
  const result = await loadKnowledge(database(records), { now: NOW, limit: 10 })
  assert.ok(result.items.reduce((sum, item) => sum + item.content.length + item.title.length, 0) <= 8000)
  assert.ok(result.warnings.some(v => v.startsWith('KNOWLEDGE_CONTENT_TRUNCATED:')))
  assert.ok(result.warnings.some(v => v.startsWith('KNOWLEDGE_SOURCE_MISSING:')))
  const first = await loadKnowledge(database([entry('x')]), { now: NOW })
  const changed = await loadKnowledge(database([entry('x', { content: '修订后的评估规则' })]), { now: NOW })
  assert.notEqual(first.version, changed.version)
})

test('database errors are explicit and never returned as empty knowledge', async () => {
  await assert.rejects(loadKnowledge(database([], new Error('permission denied')), { now: NOW }), error => error.code === 'KNOWLEDGE_READ_FAILED')
})
