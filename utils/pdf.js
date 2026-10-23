// JPEG-backed standard A4 PDF. One bounded canvas maps to one page.
const bytes = s => new Uint8Array(Array.from(s, c => c.charCodeAt(0)))
function join(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  parts.forEach(p => { out.set(p, offset); offset += p.length })
  return out
}
function encodeImages(images) {
  if (!images.length) throw new Error('报告没有可导出的页面')
  const objects = []
  const obj = (id, content) => objects.push(join([bytes(id + ' 0 obj\n'), typeof content === 'string' ? bytes(content) : content, bytes('\nendobj\n')]))
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [' + images.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] /Count ' + images.length + ' >>')
  images.forEach((im, i) => {
    const id = 3 + i * 3
    if (!(im.width > 0 && im.height > 0 && im.data.length)) throw new Error('报告图片无效')
    const ratio = Math.min(595.28 / im.width, 841.89 / im.height)
    const w = im.width * ratio, h = im.height * ratio
    const stream = bytes('q ' + w.toFixed(4) + ' 0 0 ' + h.toFixed(4) + ' ' + ((595.28 - w) / 2).toFixed(4) + ' ' + ((841.89 - h) / 2).toFixed(4) + ' cm /Im Do Q\n')
    obj(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im ' + (id + 2) + ' 0 R >> >> /Contents ' + (id + 1) + ' 0 R >>')
    obj(id + 1, join([bytes('<< /Length ' + stream.length + ' >>\nstream\n'), stream, bytes('endstream')]))
    obj(id + 2, join([bytes('<< /Type /XObject /Subtype /Image /Width ' + im.width + ' /Height ' + im.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n'), im.data, bytes('\nendstream')]))
  })
  const header = bytes('%PDF-1.4\n'), offsets = [0]
  let offset = header.length
  objects.forEach(o => { offsets.push(offset); offset += o.length })
  const xref = 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  return join([header, ...objects, bytes(xref + 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + offset + '\n%%EOF\n')])
}
async function generate(imagePaths) {
  const fs = wx.getFileSystemManager(), images = []
  for (const path of Array.isArray(imagePaths) ? imagePaths : [imagePaths]) {
    const info = await new Promise((resolve, reject) => wx.getImageInfo({src: path, success: resolve, fail: reject}))
    const result = await new Promise((resolve, reject) => fs.readFile({filePath: path, success: resolve, fail: reject}))
    images.push({width: info.width, height: info.height, data: new Uint8Array(result.data)})
  }
  const body = encodeImages(images)
  const path = wx.env.USER_DATA_PATH + '/购房评估报告_' + Date.now() + '.pdf'
  await new Promise((resolve, reject) => fs.writeFile({filePath: path, data: body.buffer, success: resolve, fail: reject}))
  return {ok: true, path}
}
module.exports = {generate, encodeImages}
