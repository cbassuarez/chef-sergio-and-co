// Lists every decision still open. Prototype: informational. Production: any open decision fails, including the
// booking settings in src/content/booking.ts, which only render in the browser (so they're checked from the built module):
// a production build without booking.apiBase would ship the in-browser mock and take fake bookings.
import fs from 'node:fs'
import { DIST, loadRoutes, PROD, report, walk } from './lib.mjs'

const open = new Map()
for (const f of walk(DIST).filter((f) => f.endsWith('.html'))) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/data-tbd="([^"]+)"/g)) open.set(m[1], (open.get(m[1]) ?? 0) + 1)
}
const { booking } = await loadRoutes()
const bookingOpen = []
if (!booking.apiBase) bookingOpen.push('booking.apiBase (the live Worker URL; without it the site runs the mock)')
for (const [k, rules] of Object.entries(booking.formats)) for (const [field, v] of Object.entries(rules)) if (v === null) bookingOpen.push(`booking.formats.${k}.${field}`)
if (booking.menuCall === null) bookingOpen.push('booking.menuCall')
const list = [...open.keys(), ...bookingOpen].sort()
report(
  PROD ? 'placeholders: no open decisions in a production build' : `placeholders: ${list.length} open decisions for Sergio (allowed in prototype)`,
  PROD ? list.map((k) => `open: ${k}`) : [],
  PROD ? [] : [list.join(', ')],
)
