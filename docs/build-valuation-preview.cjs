// Uses the mini-program's actual structured collector, canvas layout and PDF encoder.
// Run with NODE_PATH pointing to a runtime containing @napi-rs/canvas and pdf-lib.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')
const { PDFDocument } = require('pdf-lib')
const root = path.resolve(__dirname, '..')
const client = require('../utils/valuation-client')
const exporter = require('../utils/report-export')
const layout = require('../utils/report-layout')
const pdf = require('../utils/pdf')
const output = path.join(root, 'output/pdf')
const temp = path.join(root, 'tmp/pdfs/valuation-preview')

function registerFonts() {
  const font = fs.readFileSync(path.join(root, 'styles/fonts.wxss'), 'utf8').match(/base64,([^"')]+)/)
  if (!font) throw new Error('未找到项目中的中文字体')
  const bytes = Buffer.from(font[1], 'base64')
  GlobalFonts.register(bytes, 'WenKai')
  // The app font is a historical character subset. Register full local fonts for
  // native canvas QA so newly added Chinese text and units are rendered intact.
  const serif = process.env.VALUATION_SERIF_FONT || '/System/Library/Fonts/Supplemental/Songti.ttc'
  const sans = process.env.VALUATION_SANS_FONT || '/System/Library/Fonts/STHeiti Light.ttc'
  if (!fs.existsSync(serif) || !fs.existsSync(sans)) throw new Error('请通过 VALUATION_SERIF_FONT / VALUATION_SANS_FONT 指定完整中文字体')
  GlobalFonts.registerFromPath(serif, 'WenKai')
  GlobalFonts.registerFromPath(sans, 'PingFang SC')
  GlobalFonts.registerFromPath(sans, 'Microsoft YaHei')
}

function verifyLayout(ctx, pages) {
  for (const [index, page] of pages.entries()) {
    assert.ok(page.commands.some(c => c.type === 'text' && c.text === '演示数据 · 仅用于功能验证'), 'Missing demo label on page ' + (index + 1))
    for (const c of page.commands) {
      if (c.type === 'rect') {
        assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= layout.width + 1 && c.y + c.h <= layout.height + 1, 'Rectangle outside page ' + (index + 1))
      } else {
        ctx.font = (c.bold ? 'bold ' : '') + c.size + 'px ' + (c.serif ? '"WenKai","STKaiti","KaiTi",' : '') + '"PingFang SC","Microsoft YaHei",sans-serif'
        assert.ok(c.y >= 0 && c.y + c.size <= layout.height, 'Text outside page ' + (index + 1))
        assert.ok(c.x + ctx.measureText(c.text).width <= layout.width - 20, 'Text too wide on page ' + (index + 1) + ': ' + c.text)
      }
    }
  }
}

async function build(scenario, targetType = 'house') {
  const report = await client.createEvaluation({ targetType, houseId: targetType === 'house' ? 'demo-house-001' : undefined,
    communityId: targetType === 'community' ? 'demo-community-001' : undefined, requestId: 'preview-' + targetType + '-' + scenario }, { demo: true, scenario })
  const data = exporter.collect({ data: { valuationReport: report, demoMode: true } })
  const canvas = createCanvas(layout.width * 2, layout.height * 2)
  const ctx = canvas.getContext('2d')
  ctx.scale(2, 2)
  const pages = layout.buildPages(ctx, data)
  verifyLayout(ctx, pages)
  const images = pages.map((page, index) => {
    layout.paintPage(ctx, page)
    if (scenario === 'normal' && targetType === 'house') fs.writeFileSync(path.join(temp, 'normal-canvas-' + String(index + 1).padStart(2, '0') + '.png'), canvas.toBuffer('image/png'))
    return { width: canvas.width, height: canvas.height, data: canvas.toBuffer('image/jpeg', 94) }
  })
  const bytes = pdf.encodeImages(images)
  const normal = scenario === 'normal' && targetType === 'house'
  const pdfPath = normal ? path.join(output, '单套房估价-演示报告.pdf') : path.join(temp, targetType + '-' + scenario + '.pdf')
  fs.writeFileSync(pdfPath, bytes)
  const document = await PDFDocument.load(bytes)
  assert.equal(document.getPageCount(), pages.length)
  document.getPages().forEach(page => {
    assert.ok(Math.abs(page.getWidth() - 595.28) < .01)
    assert.ok(Math.abs(page.getHeight() - 841.89) < .01)
  })
  const renderedText = pages.flatMap(page => page.commands.filter(c => c.type === 'text').map(c => c.text)).join('')
  assert.ok(renderedText.includes(report.valuationId), 'Report ID was lost')
  assert.ok(!renderedText.includes('[object Object]'), 'Nested raw object leaked into PDF')
  if (report.effectiveUnitPrice !== null) assert.ok(renderedText.includes(String(report.effectiveUnitPrice)), 'Effective price differs from page snapshot')
  if (report.totalPriceYuan !== null) assert.ok(renderedText.includes(String(report.totalPriceYuan)), 'Total differs from page snapshot')
  else assert.equal(data.valuationSnapshot.totalPriceYuan, null)
  if (scenario === 'review') assert.ok(renderedText.includes('待复核'))
  if (scenario === 'timeout') assert.ok(renderedText.includes('MODEL_TIMEOUT'))
  if (scenario === 'insufficient') assert.ok(renderedText.includes('暂无数据'))
  fs.writeFileSync(path.join(temp, targetType + '-' + scenario + '.json'), JSON.stringify(data, null, 2))
  return { scenario, targetType, status: report.status, pdf: pdfPath, pages: pages.length, bytes: bytes.length,
    unitPrice: report.effectiveUnitPrice, totalPriceYuan: report.totalPriceYuan }
}

async function main() {
  registerFonts()
  fs.mkdirSync(output, { recursive: true })
  fs.mkdirSync(temp, { recursive: true })
  const results = []
  for (const scenario of ['normal', 'review', 'timeout', 'missing_area', 'insufficient']) results.push(await build(scenario))
  results.push(await build('normal', 'community'))
  await assert.rejects(client.createEvaluation({ targetType: 'house', houseId: 'demo-house-001', requestId: 'preview-error' }, { demo: true, scenario: 'error' }), { code: 'DEMO_REQUEST_FAILED' })
  fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
