// Search and sharing, checked on the built HTML. Each rule below is something a search engine or a chat app
// actually does with these tags; any failure means a page would be indexed wrong, shared without its card,
// or carry structured data a validator rejects.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { cardText } from './og-cards.mjs'
import { decode, DIST, loadRoutes, report, textOf } from './lib.mjs'

const { routes, redirects, caseRedirects, IS_PROTOTYPE, site } = await loadRoutes()
const vocab = JSON.parse(fs.readFileSync('content/schemaorg-vocab.json', 'utf8'))
const cards = fs.existsSync('public/og/manifest.json') ? JSON.parse(fs.readFileSync('public/og/manifest.json', 'utf8')) : {}
const base = process.env.BASE_PATH || '/'
const publicUrl = (IS_PROTOTYPE && process.env.PUBLIC_URL?.replace(/\/$/, '')) || site.url
const LIMITS = { title: [30, 60], description: [70, 160], imageBytes: 300 * 1024 } // Google's display widths; WhatsApp's image cap
// The old Wix site's URLs (its pages-sitemap.xml plus the /About canonical it declared), read 2026-11-22.
const LEGACY = ['/', '/about', '/About', '/catering', '/contact', '/cookingclasses', '/privatedining']

const failures = []
const notes = []
const fail = (msg) => failures.push(msg)

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
const metas = (head, key, value) => [...head.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]).filter((t) => attr(t, key) === value)
const one = (list, what, where) => {
  if (list.length !== 1) fail(`${where}: expected one ${what}, found ${list.length}`)
  return list[0]
}
const metaContent = (head, key, value, where) => {
  const t = one(metas(head, key, value), `<meta ${key}="${value}">`, where)
  return t ? decode(attr(t, 'content') ?? '') : ''
}

// ---- schema.org: every type exists, every property is allowed on its type (or a parent type) ----
const ancestors = (t, seen = new Set()) => {
  if (seen.has(t)) return seen
  seen.add(t)
  for (const p of vocab.types[t] ?? []) ancestors(p, seen)
  return seen
}
const defined = new Set()
const referenced = []
function validateNode(node, where) {
  if (Array.isArray(node)) return node.forEach((n) => validateNode(n, where))
  if (!node || typeof node !== 'object') return
  const types = [].concat(node['@type'] ?? [])
  if (node['@id'] && types.length) defined.add(node['@id'])
  if (node['@id'] && !types.length && Object.keys(node).length === 1) referenced.push([node['@id'], where])
  for (const t of types) if (!vocab.types[t]) fail(`${where}: unknown schema.org type ${t}`)
  const family = new Set(types.flatMap((t) => [...ancestors(t)]))
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@')) continue
    if (types.length) {
      const domains = vocab.props[k]
      if (!domains) fail(`${where}: ${k} is not a schema.org property`)
      else if (!domains.some((d) => family.has(d))) fail(`${where}: ${k} isn't defined for ${types.join('/')} (allowed on ${domains.join(', ')})`)
    }
    validateNode(v, `${where} → ${k}`)
  }
}
const nodesOfType = (blocks, type) => {
  const out = []
  const visit = (n) => {
    if (Array.isArray(n)) return n.forEach(visit)
    if (!n || typeof n !== 'object') return
    if ([].concat(n['@type'] ?? []).includes(type)) out.push(n)
    Object.values(n).forEach(visit)
  }
  visit(blocks)
  return out
}

// ---- every route page ----
const seen = { title: new Map(), description: new Map() }
for (const r of routes) {
  const file = path.join(DIST, r.path, 'index.html')
  if (!fs.existsSync(file)) {
    fail(`${r.path}: not built`)
    continue
  }
  const html = fs.readFileSync(file, 'utf8')
  const head = html.slice(0, html.indexOf('</head>'))
  const where = r.path
  const indexableInProd = !r.noindex

  const titles = [...head.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => decode(m[1]))
  const title = one(titles, '<title>', where) ?? ''
  const description = metaContent(head, 'name', 'description', where)
  const canonical = attr(one([...head.matchAll(/<link rel="canonical"[^>]*>/g)].map((m) => m[0]), 'canonical', where) ?? '', 'href')
  if (canonical !== site.url + r.path) fail(`${where}: canonical ${canonical} should be ${site.url + r.path}`)
  const noindex = metas(head, 'name', 'robots').some((t) => /noindex/.test(attr(t, 'content') ?? ''))
  if (noindex !== (IS_PROTOTYPE || !!r.noindex)) fail(`${where}: ${noindex ? 'noindex on a page that should be indexed' : 'missing noindex'}`)

  if (indexableInProd) {
    const [tMin, tMax] = LIMITS.title
    const [dMin, dMax] = LIMITS.description
    if (title.length < tMin || title.length > tMax) fail(`${where}: title is ${title.length} characters (keep ${tMin}–${tMax} so Google shows it whole): "${title}"`)
    if (description.length < dMin || description.length > dMax) fail(`${where}: description is ${description.length} characters (keep ${dMin}–${dMax}): "${description}"`)
    for (const [k, v] of [['title', title], ['description', description]]) {
      if (seen[k].has(v)) fail(`${where}: same ${k} as ${seen[k].get(v)}`)
      seen[k].set(v, r.path)
    }
  }

  // Share card and Open Graph
  if (!metaContent(head, 'property', 'og:title', where)) fail(`${where}: empty og:title`)
  if (metaContent(head, 'property', 'og:description', where) !== description) fail(`${where}: og:description differs from the meta description`)
  if (metaContent(head, 'property', 'og:url', where) !== publicUrl + r.path) fail(`${where}: og:url should be ${publicUrl + r.path}`)
  if (metaContent(head, 'property', 'og:site_name', where) !== site.name) fail(`${where}: og:site_name should be ${site.name}`)
  if (metaContent(head, 'name', 'twitter:card', where) !== 'summary_large_image') fail(`${where}: twitter:card should be summary_large_image`)
  const image = metaContent(head, 'property', 'og:image', where)
  const alt = metaContent(head, 'property', 'og:image:alt', where)
  if (!alt) fail(`${where}: og:image:alt is empty`)
  if (!image.startsWith(`${publicUrl}/og/`)) fail(`${where}: og:image must be an absolute URL under ${publicUrl}/og/, got ${image}`)
  else {
    const rel = image.slice(publicUrl.length + 1).split('?')[0]
    const imgFile = path.join(DIST, rel)
    if (!fs.existsSync(imgFile)) fail(`${where}: og:image ${rel} isn't in the build`)
    else {
      const meta = await sharp(imgFile).metadata()
      const bytes = fs.statSync(imgFile).size
      if (meta.width !== 1200 || meta.height !== 630) fail(`${where}: share card is ${meta.width}×${meta.height}, not 1200×630`)
      if (String(meta.width) !== metaContent(head, 'property', 'og:image:width', where) || String(meta.height) !== metaContent(head, 'property', 'og:image:height', where))
        fail(`${where}: og:image:width/height don't match the file`)
      if (bytes > LIMITS.imageBytes) fail(`${where}: share card is ${(bytes / 1024).toFixed(0)} KB; WhatsApp drops images over 300 KB`)
    }
  }
  if (indexableInProd && cards[r.path]?.text !== cardText(r)) fail(`${where}: share card says "${cards[r.path]?.text}" but the page's card text is "${cardText(r)}" (run npm run og)`)

  // Structured data
  const blocks = []
  for (const m of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      blocks.push(JSON.parse(m[1]))
    } catch (e) {
      fail(`${where}: JSON-LD doesn't parse (${e.message})`)
    }
  }
  validateNode(blocks, where)
  const text = textOf(html)
  for (const q of nodesOfType(blocks, 'Question')) {
    // Structured data has to describe what's on the page; Google treats invisible FAQ markup as spam.
    const norm = (s) => decode(String(s)).replace(/<[^>]+>/g, ' ').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()
    const visible = norm(text)
    if (!visible.includes(norm(q.name))) fail(`${where}: FAQ markup question isn't visible on the page: "${q.name}"`)
    if (!visible.includes(norm(q.acceptedAnswer?.text ?? ''))) fail(`${where}: FAQ markup answer isn't the visible answer for "${q.name}"`)
  }
  for (const b of nodesOfType(blocks, 'LocalBusiness')) if (Object.keys(b).length > 4 && (!b.name || !b.address)) fail(`${where}: LocalBusiness needs name and address`)
  const sites = nodesOfType(blocks, 'WebSite')
  if (r.path === '/') {
    if (sites.length !== 1 || sites[0].name !== site.name || sites[0].url !== `${site.url}/`) fail(`/: needs one WebSite with name "${site.name}" and url ${site.url}/ (Google's site name comes from it)`)
  } else if (sites.length) fail(`${where}: WebSite markup belongs on the home page only`)
  notes.push(`${r.path.padEnd(18)} ${noindex ? 'noindex ' : 'indexed '} title ${String(title.length).padStart(2)} · description ${String(description.length).padStart(3)} · ${blocks.length} JSON-LD`)

  // Internal links resolve without a redirect hop.
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = decode(m[1])
    if (!href.startsWith(base) || href.startsWith('//')) continue
    const p = href.slice(base.length - 1).split(/[?#]/)[0]
    const target = path.join(DIST, p)
    if (path.extname(p)) {
      if (!fs.existsSync(target)) fail(`${where}: link to missing file ${href}`)
    } else if (!fs.existsSync(path.join(target, 'index.html'))) fail(`${where}: link to missing page ${href}`)
    else if (!p.endsWith('/')) fail(`${where}: link ${href} needs a trailing slash (otherwise every click is a 301)`)
  }
}
for (const [id, where] of referenced) if (!defined.has(id)) fail(`${where}: references ${id}, which no page defines`)

// ---- robots.txt and sitemap ----
const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8')
const disallows = robots
  .split('\n')
  .map((l) => l.match(/^Disallow:\s*(\S+)/i)?.[1])
  .filter(Boolean)
  .map((rule) => new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')))
const blocked = (p) => disallows.some((re) => re.test(p))
for (const r of routes) {
  // Even noindex pages must be crawlable, or the crawler never sees the noindex.
  if (blocked(base + r.path.slice(1))) fail(`robots.txt blocks ${r.path}; a blocked page's noindex can't be read, so it can still be indexed from links`)
}
const sitemapFile = path.join(DIST, 'sitemap.xml')
if (IS_PROTOTYPE) {
  if (fs.existsSync(sitemapFile)) fail('sitemap.xml in a prototype build (every page is noindex)')
  if (/^Sitemap:/im.test(robots)) fail('robots.txt points to a sitemap in a prototype build')
} else {
  if (!robots.includes(`Sitemap: ${site.url}/sitemap.xml`)) fail(`robots.txt should end with Sitemap: ${site.url}/sitemap.xml`)
  const locs = fs.existsSync(sitemapFile) ? [...fs.readFileSync(sitemapFile, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]) : []
  const want = routes.filter((r) => !r.noindex).map((r) => site.url + r.path)
  for (const u of want) if (!locs.includes(u)) fail(`sitemap.xml is missing ${u}`)
  for (const u of locs) if (!want.includes(u)) fail(`sitemap.xml lists ${u}, which isn't an indexable page`)
}

// ---- old Wix URLs still land somewhere real ----
const caseSensitive = !fs.existsSync(path.join(DIST, 'INDEX.HTML'))
for (const old of LEGACY) {
  const dir = path.join(DIST, old)
  if (!fs.existsSync(path.join(dir, 'index.html'))) fail(`old URL ${old} has no page or redirect`)
}
for (const [from, to] of Object.entries({ ...redirects, ...(caseSensitive ? caseRedirects : {}) })) {
  const stub = fs.readFileSync(path.join(DIST, from, 'index.html'), 'utf8')
  if (!stub.includes(`content="0; url=${base}${to.slice(1)}"`) || !stub.includes(`href="${site.url}${to}"`)) fail(`${from}: redirect stub doesn't point at ${to}`)
}
notes.push(`old Wix URLs: ${LEGACY.length} resolve${caseSensitive ? '' : ' (case-insensitive filesystem here: /About is checked for real in the Linux deploy build)'}`)
notes.push(`robots.txt: ${IS_PROTOTYPE ? 'prototype, crawlable with noindex, reference photos blocked' : 'production, everything allowed, sitemap listed'}`)

report('seo: titles, canonicals, share cards, structured data, robots and sitemap', failures, notes)
