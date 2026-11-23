// Minimal static server for dist/, mimicking GitHub Pages (directory index, 404.html, trailing-slash redirect).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'

// DIST_DIR lets a test serve a snapshot of the build, so a concurrent rebuild of dist/ can't change files mid-run.
const ROOT = path.resolve(process.env.DIST_DIR || 'dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml' }

export function serve(port = Number(process.env.PORT) || 4173) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let p = path.join(ROOT, decodeURIComponent(url.pathname))
    if (!p.startsWith(ROOT)) return res.writeHead(403).end()
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      if (!url.pathname.endsWith('/')) return res.writeHead(301, { Location: url.pathname + '/' + url.search }).end()
      p = path.join(p, 'index.html')
    }
    if (!fs.existsSync(p)) {
      res.writeHead(404, { 'Content-Type': TYPES['.html'] })
      return res.end(fs.readFileSync(path.join(ROOT, '404.html')))
    }
    const type = TYPES[path.extname(p)] ?? 'application/octet-stream'
    const headers = { 'Content-Type': type, 'Cache-Control': p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }
    // GitHub Pages gzips text assets; do the same so local audits measure what visitors get.
    if (/text|javascript|json|xml|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' })
      return fs.createReadStream(p).pipe(zlib.createGzip()).pipe(res)
    }
    res.writeHead(200, headers)
    fs.createReadStream(p).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serve()
  console.log(`serving dist/ at http://localhost:${Number(process.env.PORT) || 4173}`)
}
