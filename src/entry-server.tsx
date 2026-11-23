import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { App } from './App'
import { IS_PROTOTYPE, site } from './content/site'
import { caseRedirects, redirects, routes } from './routes'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export type ShareImage = { path: string; width: number; height: number; type: string; alt: string }

/**
 * `publicUrl`: the absolute URL this build is served from, without a trailing slash. It's the real domain in
 * production; a prototype preview can pass its own (PUBLIC_URL) so links shared from it still show their card.
 * Canonicals always point at the real domain.
 */
export function render(path: string, { image, publicUrl = site.url }: { image?: ShareImage; publicUrl?: string } = {}) {
  const r = routes.find((x) => x.path === path)!
  const html = renderToString(
    <StrictMode>
      <App path={path} Page={r.Page} />
    </StrictMode>,
  )
  const canonical = site.url + path
  const noindex = IS_PROTOTYPE || r.noindex
  // Chat apps show og:title under the card and the site name or domain beside it, so drop the brand suffix.
  const ogTitle = r.og?.title ?? r.title.replace(/\s*\|\s*Chef Sergio & Co\.$/, '')
  const head = [
    `<title>${esc(r.title)}</title>`,
    `<meta name="description" content="${esc(r.description)}">`,
    `<link rel="canonical" href="${canonical}">`,
    noindex ? `<meta name="robots" content="noindex">` : '',
    path === '/' && site.seo.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(site.seo.googleSiteVerification)}">` : '',
    `<meta property="og:site_name" content="${esc(site.name)}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(ogTitle)}">`,
    `<meta property="og:description" content="${esc(r.description)}">`,
    `<meta property="og:url" content="${publicUrl}${path}">`,
    ...(image
      ? [
          `<meta property="og:image" content="${publicUrl}/${image.path}">`,
          `<meta property="og:image:type" content="${image.type}">`,
          `<meta property="og:image:width" content="${image.width}">`,
          `<meta property="og:image:height" content="${image.height}">`,
          `<meta property="og:image:alt" content="${esc(image.alt)}">`,
        ]
      : []),
    `<meta name="twitter:card" content="summary_large_image">`,
    ...(r.jsonld ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
  ]
    .filter(Boolean)
    .join('\n    ')
  return { html, head, route: r }
}

export { caseRedirects, redirects, routes, IS_PROTOTYPE, site }
export { booking } from './content/booking'
