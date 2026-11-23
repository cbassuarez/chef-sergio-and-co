// Refreshes content/schemaorg-vocab.json, the compact copy of the schema.org vocabulary that check-seo.mjs
// validates our JSON-LD against (every type exists; every property is allowed on its type). Committed, so the
// build never needs the network. Refresh occasionally: node scripts/schema-vocab.mjs
import fs from 'node:fs'

const SRC = 'https://schema.org/version/latest/schemaorg-current-https.jsonld'
const res = await fetch(SRC)
if (!res.ok) throw new Error(`${SRC}: HTTP ${res.status}`)
const graph = (await res.json())['@graph']
const ids = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map((x) => x['@id'].replace(/^schema:/, '')))
const types = {}
const props = {}
for (const n of graph) {
  const kind = [].concat(n['@type'])
  const id = n['@id'].replace(/^schema:/, '')
  if (kind.includes('rdfs:Class')) types[id] = ids(n['rdfs:subClassOf']).filter((p) => !p.includes(':'))
  if (kind.includes('rdf:Property')) props[id] = ids(n['schema:domainIncludes'])
}
const out = { source: SRC, fetched: new Date().toISOString().slice(0, 10), types, props }
fs.writeFileSync('content/schemaorg-vocab.json', JSON.stringify(out))
console.log(`schema.org vocabulary: ${Object.keys(types).length} types, ${Object.keys(props).length} properties`)
