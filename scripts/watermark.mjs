// Builds licensed reference images from reference/selection.json.
// References are watermarked by default. A slot explicitly marked treatment:"captioned" keeps a clean image
// and requires an adjacent disclosure and credit in rendered HTML, enforced by check-images.mjs.
// All outputs are hashed on decoded pixels. --slot=name updates one slot without replacing the reference pack.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const selection = JSON.parse(fs.readFileSync('reference/selection.json', 'utf8'))
const args = process.argv.slice(2)
if (args.length > 1 || args.some((arg) => !arg.startsWith('--slot='))) throw new Error('Usage: node scripts/watermark.mjs [--slot=name]')
const onlySlot = args[0]?.slice('--slot='.length)
if (args.length && (!onlySlot || onlySlot.startsWith('_') || !selection[onlySlot])) throw new Error(`Unknown reference slot: ${onlySlot || '(empty)'}`)
const CACHE = '.cache/refs'
const OUT = 'public/reference'
const CREDITS = 'src/content/reference-credits.json'
const WIDTHS = [640, 960, 1280]
const ASPECT = { '4:5': 4 / 5, '4:3': 4 / 3, '3:2': 3 / 2, '1:1': 1 }
const AI_MARKERS = ['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia']
fs.mkdirSync(CACHE, { recursive: true })
if (!onlySlot) fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function overlay(w, h, slot, credit, shape) {
  const fs1 = Math.round(w / 17)
  if (shape === 'circle') return circleOverlay(w, h, fs1, credit)
  const rows = []
  for (let y = -h; y < h * 2; y += fs1 * 3.2) {
    rows.push(
      `<text x="${-w}" y="${y}" font-size="${fs1}" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" font-weight="700" fill="#fff" fill-opacity="0.5" stroke="#000" stroke-opacity="0.35" stroke-width="${Math.max(1, fs1 / 28)}">${'REFERENCE ONLY · NOT FOR FINAL USE · '.repeat(6)}</text>`,
    )
  }
  const bar = Math.round(Math.max(56, w * 0.11))
  const t1 = Math.round(bar * 0.3)
  const t2 = Math.round(bar * 0.22)
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <g transform="rotate(-28 ${w / 2} ${h / 2})">${rows.join('')}</g>
  <rect x="0" y="${h - bar}" width="${w}" height="${bar}" fill="#10201A" fill-opacity="0.86"/>
  <text x="${bar * 0.25}" y="${h - bar + t1 * 1.35}" font-size="${t1}" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" font-weight="700" fill="#FFE98A">REFERENCE: use Sergio's own photo</text>
  <text x="${bar * 0.25}" y="${h - bar * 0.18}" font-size="${t2}" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" fill="#fff">${xml(credit)}</text>
</svg>`)
}

// Circle-cropped slots (a dish seen from above): the credit band sits inside the circle, centered, so the crop can't hide it.
function circleOverlay(w, h, fs1, credit) {
  const rows = []
  for (let y = -h; y < h * 2; y += fs1 * 3.2) {
    rows.push(`<text x="${-w}" y="${y}" font-size="${fs1}" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" font-weight="700" fill="#fff" fill-opacity="0.5" stroke="#000" stroke-opacity="0.35" stroke-width="${Math.max(1, fs1 / 28)}">${'REFERENCE ONLY · NOT FOR FINAL USE · '.repeat(6)}</text>`)
  }
  const bh = Math.round(h * 0.16)
  const t1 = Math.round(bh * 0.3)
  const t2 = Math.round(bh * 0.2)
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <g transform="rotate(-28 ${w / 2} ${h / 2})">${rows.join('')}</g>
  <rect x="${w * 0.12}" y="${h * 0.62}" width="${w * 0.76}" height="${bh}" rx="${bh * 0.2}" fill="#10201A" fill-opacity="0.86"/>
  <text x="${w / 2}" y="${h * 0.62 + bh * 0.45}" text-anchor="middle" font-size="${t1}" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" font-weight="700" fill="#FFE98A">REFERENCE: use Sergio's own photo</text>
  <text x="${w / 2}" y="${h * 0.62 + bh * 0.8}" text-anchor="middle" font-size="${t2}" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" fill="#fff">${xml(credit)}</text>
</svg>`)
}

const credits = onlySlot && fs.existsSync(CREDITS) ? JSON.parse(fs.readFileSync(CREDITS, 'utf8')) : {}
for (const [slot, s] of Object.entries(selection)) {
  if (slot.startsWith('_') || (onlySlot && slot !== onlySlot)) continue
  const treatment = s.treatment ?? 'watermarked'
  if (!['watermarked', 'captioned'].includes(treatment)) throw new Error(`${slot}: unknown reference treatment ${treatment}`)
  for (const key of ['creator', 'license', 'license_url', 'landing', 'provider']) {
    if (!s[key]) throw new Error(`${slot}: missing reference credit ${key}`)
  }
  const cacheFile = path.join(CACHE, `${slot}.bin`)
  if (!fs.existsSync(cacheFile)) {
    const r = await fetch(s.src, { headers: { 'User-Agent': 'reference-board-builder/0.1' } })
    if (!r.ok) throw new Error(`${slot}: download failed ${r.status}`)
    fs.writeFileSync(cacheFile, Buffer.from(await r.arrayBuffer()))
  }
  const raw = fs.readFileSync(cacheFile)
  const rawStr = raw.toString('latin1')
  if (AI_MARKERS.some((m) => rawStr.includes(m))) throw new Error(`${slot}: source carries a generative-AI content credential, rejected`)

  const nativeAspect = s.aspect === 'source'
  const metadata = nativeAspect ? await sharp(raw).metadata() : null
  const swapsAxes = metadata && [5, 6, 7, 8].includes(metadata.orientation)
  const sourceWidth = metadata ? (swapsAxes ? metadata.height : metadata.width) : null
  const sourceHeight = metadata ? (swapsAxes ? metadata.width : metadata.height) : null
  if (nativeAspect && (!sourceWidth || !sourceHeight)) throw new Error(`${slot}: source dimensions are unavailable`)
  const ratio = nativeAspect ? sourceWidth / sourceHeight : ASPECT[s.aspect] ?? 4 / 5
  const credit = `Photo: ${(s.creator || 'unknown').slice(0, 48)}, ${s.license.toUpperCase()} via ${s.provider}`
  const files = []
  let dims
  for (const w of s.widths ?? WIDTHS) {
    if (nativeAspect && (!Number.isInteger(w) || w < 1 || w > sourceWidth)) throw new Error(`${slot}: source-aspect width ${w} must be a positive integer no larger than ${sourceWidth}`)
    const h = Math.round(w / ratio)
    const image = nativeAspect
      ? sharp(raw).rotate().resize({ width: w, withoutEnlargement: true })
      : sharp(await sharp(raw).rotate().resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).toBuffer())
    if (treatment === 'watermarked') image.composite([{ input: overlay(w, h, slot, credit, s.shape) }])
    const encoded = await image.webp({ quality: treatment === 'captioned' ? 84 : 72 }).toBuffer({ resolveWithObject: true })
    const out = encoded.data
    const pixels = await sharp(out).raw().toBuffer()
    const file = `reference/${slot}-${w}.webp`
    fs.writeFileSync(path.join('public', file), out)
    files.push({ w, file, sha256: crypto.createHash('sha256').update(pixels).digest('hex'), bytes: out.length })
    dims = { width: encoded.info.width, height: encoded.info.height }
  }
  credits[slot] = { ...dims, files, title: s.title, creator: s.creator, license: s.license, license_url: s.license_url, landing: s.landing, provider: s.provider, aspect: s.aspect, shape: s.shape ?? null,
    ...(nativeAspect ? { source_width: sourceWidth, source_height: sourceHeight, license_version: s.license_version ?? null } : {}),
    ...(treatment === 'captioned' ? { treatment, src: s.src, source_sha256: crypto.createHash('sha256').update(raw).digest('hex'), provenance: s.provenance } : {}) }
  console.log(treatment, slot, files.map((f) => `${f.w}w ${(f.bytes / 1024).toFixed(0)}KB`).join(', '))
}
// A slot build merges into the latest credits so unrelated concurrent entries are preserved.
const mergedCredits = onlySlot && fs.existsSync(CREDITS) ? JSON.parse(fs.readFileSync(CREDITS, 'utf8')) : credits
if (onlySlot) mergedCredits[onlySlot] = credits[onlySlot]
fs.writeFileSync(CREDITS, JSON.stringify(mergedCredits, null, 1))
console.log(`${onlySlot ? '1 slot updated' : `${Object.keys(credits).length} slots written`}; credits in ${CREDITS}`)
