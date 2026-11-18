// An explicit in-memory database double. No credentials or external requests.
function memoryDb(seed = {}) {
  const records = structuredClone(seed)
  const calls = []
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object') {
      if ('$exists' in value) return Object.hasOwn(row, key) === value.$exists
      if ('$in' in value) return value.$in.includes(row[key])
    }
    return row[key] === value
  })
  const db = {
    records, calls,
    command: { exists: value => ({ $exists: value }), in: values => ({ $in: values }) },
    collection(name) {
      records[name] ||= []
      const rows = records[name]
      return {
        doc(id) {
          return {
            async get() {
              calls.push(['get', name, id])
              const row = rows.find(item => item._id === id)
              if (!row) throw Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' })
              return { data: structuredClone(row) }
            },
            async update({ data }) {
              calls.push(['update', name, id])
              const row = rows.find(item => item._id === id)
              if (!row) throw new Error('document not found')
              Object.assign(row, structuredClone(data))
              return { stats: { updated: 1 } }
            }
          }
        },
        async add({ data }) {
          calls.push(['add', name, data._id])
          if (rows.some(item => item._id === data._id)) throw new Error('duplicate key')
          rows.push(structuredClone(data))
          return { _id: data._id }
        },
        where(filter) {
          let offset = 0, count = 100, order = null
          const chain = {
            skip(n) { offset = n; return chain }, limit(n) { count = n; return chain },
            orderBy(key, direction) { order = [key, direction]; return chain },
            async get() {
              calls.push(['query', name, filter])
              let selected = rows.filter(row => match(row, filter))
              if (order) selected = selected.slice().sort((a, b) => String(a[order[0]] || '').localeCompare(String(b[order[0]] || '')) * (order[1] === 'desc' ? -1 : 1))
              return { data: structuredClone(selected.slice(offset, offset + count)) }
            }
          }
          return chain
        }
      }
    }
  }
  return db
}
module.exports = { memoryDb }
