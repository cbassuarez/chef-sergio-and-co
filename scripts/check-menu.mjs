// Menu fidelity: every dish the site renders must be in content/menu.source.json (captured verbatim from his site),
// and every dish in the source must appear on the site. Any difference fails the build.
import fs from 'node:fs'
import { DIST, report, textOf, walk } from './lib.mjs'

const source = JSON.parse(fs.readFileSync('content/menu.source.json', 'utf8')).named.map((d) => d.name)
const rendered = new Map()
for (const f of walk(DIST).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8')
  for (const m of html.matchAll(/<[a-z0-9]+[^>]*data-menu-item[^>]*>([\s\S]*?)<\/[a-z0-9]+>/g)) {
    const name = textOf(m[1])
    rendered.set(name, (rendered.get(name) ?? 0) + 1)
  }
}
const extra = [...rendered.keys()].filter((n) => !source.includes(n))
const missing = source.filter((n) => !rendered.has(n))
report(
  'menu fidelity: rendered dishes match the captured source exactly',
  [...extra.map((n) => `rendered but not in source: "${n}"`), ...missing.map((n) => `in source but never rendered: "${n}"`)],
  [`source: ${source.length} dishes; rendered: ${rendered.size} distinct, ${[...rendered.values()].reduce((a, b) => a + b, 0)} placements`],
)
