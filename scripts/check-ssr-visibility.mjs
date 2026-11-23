// Motion must never hide prerendered content: a framer `initial` state in the static HTML (opacity:0, a clipped
// reveal, an off-screen transform) means no-JS visitors and crawlers see nothing there, and the first paint waits on JS.
import fs from 'node:fs'
import path from 'node:path'
import { DIST, report, walk } from './lib.mjs'

const HIDDEN = [/opacity:\s*0(?![.\d])/, /clip-path:\s*inset\(0(px)? 100%/, /visibility:\s*hidden/, /transform:\s*translate[XY]?\((-?1\d\d|-?[2-9]\d\d)%/]
const failures = []
let styled = 0
for (const f of walk(DIST).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8')
  const body = html.slice(html.indexOf('<body'))
  for (const m of body.matchAll(/<([a-z0-9]+)[^>]*\sstyle="([^"]*)"[^>]*>/g)) {
    // aria-hidden elements are deliberately invisible plumbing (e.g. Radix's native <input> mirrors), not content.
    if (/aria-hidden="true"/.test(m[0])) continue
    styled++
    const hit = HIDDEN.find((re) => re.test(m[2]))
    if (hit) failures.push(`${path.relative(DIST, f)}: <${m[1]} style="${m[2].slice(0, 80)}"> hides content until JavaScript runs`)
  }
}
report('ssr visibility: no content hidden until JavaScript', failures, [`${styled} inline-styled elements checked`])
