import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// DIST_DIR / SSR_DIR point the checks at another build (a snapshot, or a production-mode copy).
export const DIST = path.resolve(process.env.DIST_DIR || 'dist')
export const PROD = process.env.SITE_MODE === 'production'

export async function loadRoutes() {
  return import(pathToFileURL(path.resolve(process.env.SSR_DIR || 'dist-ssr', 'entry-server.js')).href)
}

export function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    e.isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}

export const decode = (s) =>
  s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

/** Visible text of an HTML page with scripts and styles removed: what a crawler with JS disabled sees. */
export const textOf = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()

export function report(name, failures, notes = []) {
  for (const n of notes) console.log(`  · ${n}`)
  if (failures.length) {
    console.error(`✗ ${name}: ${failures.length} failure(s)`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`✓ ${name}`)
}
