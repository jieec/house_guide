// Run with NODE_PATH pointing to a runtime containing @napi-rs/canvas and pdf-lib.
// Uses the same canvas layout and PDF encoder as the mini program.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')
const { PDFDocument } = require('pdf-lib')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'output/pdf'), temp = path.join(root, 'tmp/pdfs')
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(temp, { recursive: true })
const fontSource = fs.readFileSync(path.join(root, 'styles/fonts.wxss'), 'utf8').match(/base64,([^"')]+)/)[1]
GlobalFonts.register(Buffer.from(fontSource, 'base64'), 'WenKai')
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei')
GlobalFonts.registerFromPath('C:/Windows/Fonts/simkai.ttf', 'KaiTi')
// Reuse the clearly labeled local sample fixture, without rebuilding HTML.
const fixture = { module: { exports: {} }, require: createRequire(__filename), __dirname, console, setTimeout, clearTimeout }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'build-guide-preview.cjs'), 'utf8').split('const source =')[0] + '\nmodule.exports = {page, doc, report, missingReport}', fixture)
const { page, doc, report, missingReport } = fixture.module.exports
global.wx = { getStorageSync: () => ({}) }
const exporter = require('../utils/report-export.js'), layout = require('../utils/report-layout.js'), pdf = require('../utils/pdf.js')
const samplePage = { data: { ...page.data, report, selectedCommunity: doc, updatedAt: '示例数据', } }
const data = exporter.collect(samplePage)
data.title = '云栖花园 · 演示报告'
data.subtitle = '示例城市 / 示例区域 · 所有数值仅用于排版演示'
data.generatedAt = '2026-10-24'
const canvas = createCanvas(layout.width * 2, layout.height * 2), ctx = canvas.getContext('2d')
ctx.scale(2, 2)
function validate(pages) {
  for (const [i, p] of pages.entries()) for (const c of p.commands) {
    if (c.type === 'rect') {
      assert(c.y >= 0 && c.y + c.h <= layout.height + 1, `Rectangle outside page ${i + 1}`)
      assert(c.x >= 0 && c.x + c.w <= layout.width + 1, `Rectangle too wide page ${i + 1}`)
    } else {
      assert(c.y >= 0 && c.y + c.size <= layout.height, `Text outside page ${i + 1}: ${c.text}`)
      ctx.font = (c.bold ? 'bold ' : '') + c.size + 'px ' + (c.serif ? '"WenKai","STKaiti","KaiTi",' : '') + '"PingFang SC","Microsoft YaHei",sans-serif'
      assert(c.x + ctx.measureText(c.text).width <= layout.width - 22, `Text too wide page ${i + 1}: ${c.text}`)
    }
  }
}
async function main() {
  const pages = layout.buildPages(ctx, data); validate(pages)
  const images = pages.map((p, i) => {
    layout.paintPage(ctx, p)
    fs.writeFileSync(path.join(temp, 'canvas-' + String(i + 1).padStart(2, '0') + '.png'), canvas.toBuffer('image/png'))
    return {width: canvas.width, height: canvas.height, data: canvas.toBuffer('image/jpeg', 94)}
  })
  const bytes = pdf.encodeImages(images)
  const pdfPath = path.join(output, '小区评估报告-雾紫样张.pdf')
  fs.writeFileSync(pdfPath, bytes)
  const parsed = await PDFDocument.load(bytes)
  assert.equal(parsed.getPageCount(), pages.length)
  parsed.getPages().forEach(p => {assert(Math.abs(p.getWidth() - 595.28) < .01); assert(Math.abs(p.getHeight() - 841.89) < .01)})
  // Missing values, multiline paragraphs, long labels and very long values.
  const missing = exporter.collect({data: {report: missingReport}})
  validate(layout.buildPages(ctx, missing))
  const longValue = '分页测试：长内容也必须完整保留。'.repeat(900) + '\nEND_SENTINEL'
  const stress = {...data, title: '超长小区名称'.repeat(40), sections: [{number:'01', title:'基本信息', items:[{label:'长字段名称'.repeat(8), value:longValue, note:'多行备注\n第二行备注'}]}]}
  const stressPages = layout.buildPages(ctx, stress); validate(stressPages)
  const text = stressPages.flatMap(p => p.commands).filter(c => c.type === 'text').map(c => c.text).join('')
  assert(text.includes('END_SENTINEL'), 'Long text lost its ending')
  const valueText = stressPages.flatMap(p => p.commands).filter(c => c.type === 'text' && c.x === 246).map(c => c.text).join('')
  assert(valueText.includes(longValue.replace(/\n/g, '')), 'Long text changed or was lost at page breaks')
  // Exercise the actual button export path using platform adapters. This checks
  // sequencing, full-canvas capture, image cleanup, duplicate taps and errors.
  const files = new Map(), deleted = [], opened = [], errors = []
  const exportCanvas = createCanvas(1, 1)
  exportCanvas.requestAnimationFrame = cb => setTimeout(cb, 0)
  let sequence = 0, failCapture = false
  const manager = {
    readFile: o => { const b = files.get(o.filePath); o.success({data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)}) },
    writeFile: o => { files.set(o.filePath, Buffer.from(o.data)); o.success({}) },
    unlink: o => {deleted.push(o.filePath); files.delete(o.filePath)}
  }
  global.wx = {
    getStorageSync: () => ({}), env: {USER_DATA_PATH: '/mock'}, getFileSystemManager: () => manager,
    showLoading() {}, hideLoading() {}, showToast: o => errors.push(o.title),
    createSelectorQuery: () => ({in() {return this}, select() {return this}, fields() {return this}, exec(cb) {cb([{node:exportCanvas}])}}),
    canvasToTempFilePath: o => {
      assert.equal(o.width, undefined, 'Capture must not crop a physical 2x canvas to logical width')
      if (failCapture && sequence === 1) {o.fail({errMsg:'模拟截图失败'}); return}
      const name = '/page-' + sequence++ + '.jpg'
      files.set(name, o.canvas.toBuffer('image/jpeg', 94)); o.success({tempFilePath:name})
    },
    getImageInfo: o => o.success({width:layout.width * 2, height:layout.height * 2}),
    openDocument: o => {opened.push(o.filePath); o.success({})}
  }
  const flowPage = {data: samplePage.data}
  await Promise.all([exporter.exportReport(flowPage), exporter.exportReport(flowPage)])
  assert.equal(opened.length, 1, 'Duplicate taps created multiple documents')
  const flowPdf = await PDFDocument.load(files.get(opened[0])); assert.equal(flowPdf.getPageCount(), pages.length)
  assert.equal(deleted.length, pages.length); assert.equal(exportCanvas.width, 1)
  assert.equal(flowPage._exportingReport, false); assert.equal(errors.length, 0)
  sequence = 0; failCapture = true
  await exporter.exportReport(flowPage)
  assert.equal(opened.length, 1); assert.equal(errors.length, 1)
  assert.equal(flowPage._exportingReport, false); assert.equal(exportCanvas.width, 1)
  assert(!files.has('/page-0.jpg'), 'Failed export leaked a temporary page')
  console.log(JSON.stringify({pdf:pdfPath, pages:pages.length, bytes:bytes.length, stressPages:stressPages.length, checks:'A4 page tree, page bounds, missing values, long text preservation passed'}, null, 2))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
