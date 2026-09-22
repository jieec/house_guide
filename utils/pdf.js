function textBytes(s) {
  const b = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 128) b.push(c)
    else b.push(0xEF, 0xBF, 0xBD)
  }
  return new Uint8Array(b)
}

function strBytes(s) {
  const out = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x28 || c === 0x29 || c === 0x5C) out.push(0x5C, c)
    else if (c < 128) out.push(c)
    else out.push(0xEF, 0xBF, 0xBD)
  }
  return new Uint8Array(out)
}

function u8cat(...arrs) {
  let len = 0
  for (const a of arrs) len += a.length
  const r = new Uint8Array(len)
  let off = 0
  for (const a of arrs) { r.set(a, off); off += a.length }
  return r
}

function pad(n, w) { return String(n).padStart(w, '0') }

function base64Bytes(s) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = String(s).replace(/\s/g, '')
  const out = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '=') break
    const value = chars.indexOf(clean[i])
    if (value < 0) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

function toBytes(data) {
  if (typeof data === 'string') return base64Bytes(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data instanceof Uint8Array) return data
  if (data && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength)
  }
  if (data && typeof data.byteLength === 'number') return new Uint8Array(data)
  throw new Error('无法读取报告图片二进制数据')
}

module.exports = {
  generate(imagePath) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: imagePath,
        success: (info) => {
          const fs = wx.getFileSystemManager()
          fs.readFile({
            filePath: imagePath,
            encoding: 'base64',
            success: (res) => {
              try {
                const imgData = toBytes(res.data)
                if (!imgData.length) throw new Error('报告图片为空')
                const imgW = info.width
                const imgH = info.height

                const pageW = 595
                const margin = 40
                const contentW = pageW - margin * 2
                const ratio = contentW / imgW
                const drawH = imgH * ratio
                const pageH = Math.max(842, drawH + 100)
                const imgY = pageH - margin - drawH

                const now = new Date()
                const ds = `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`

                const objs = []
                let objNum = 0

                function addObj(streamContent) {
                  objNum++
                  const body = u8cat(
                    strBytes(`${objNum} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n`),
                    streamContent,
                    strBytes('\nendstream\nendobj\n')
                  )
                  objs.push(body)
                  return objNum
                }

                function addObjRaw(raw) {
                  objNum++
                  objs.push(raw)
                  return objNum
                }

                // 1: catalog
                const catalogNum = addObjRaw(strBytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'))
                // 2: pages
                addObjRaw(strBytes('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'))
                // 3: page
                addObjRaw(u8cat(
                  strBytes(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> /Font << /F1 6 0 R >> >> >>\nendobj\n`)
                ))
                // 4: content stream (draw image)
                addObj(u8cat(
                  strBytes(`q ${contentW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${margin} ${imgY.toFixed(2)} cm /Im1 Do Q\n`)
                ))
                // 5: image XObject
                const imgObjNum = objNum + 1
                objs.push(u8cat(
                  strBytes(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgData.length} >>\nstream\n`),
                  imgData,
                  strBytes('\nendstream\nendobj\n')
                ))
                objNum++
                // 6: font
                addObjRaw(u8cat(
                  strBytes('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')
                ))

                // build PDF body
                let body = strBytes('%PDF-1.4\n')
                const offsets = []
                for (const o of objs) {
                  offsets.push(body.length)
                  body = u8cat(body, o)
                }

                // xref
                const xrefOffset = body.length
                const xrefCount = objNum + 1
                let xref = u8cat(strBytes(`xref\n0 ${xrefCount}\n`), strBytes('0000000000 65535 f \n'))
                for (let i = 0; i < objNum; i++) {
                  xref = u8cat(xref, strBytes(`${pad(offsets[i], 10)} 00000 n \n`))
                }
                body = u8cat(body, xref)

                // trailer
                body = u8cat(body, u8cat(
                  strBytes(`trailer\n<< /Size ${xrefCount} /Root 1 0 R >>\nstartxref\n`),
                  strBytes(String(xrefOffset)),
                  strBytes('\n%%EOF\n')
                ))

                const pdfPath = `${wx.env.USER_DATA_PATH}/购房评估报告_${ds.replace(/-/g, '')}.pdf`
                fs.writeFile({
                  filePath: pdfPath,
                  data: body.buffer,
                  success: () => resolve({ ok: true, path: pdfPath }),
                  fail: (e) => reject(e)
                })
              } catch (e) {
                reject(e)
              }
            },
            fail: reject
          })
        },
        fail: reject
      })
    })
  }
}
