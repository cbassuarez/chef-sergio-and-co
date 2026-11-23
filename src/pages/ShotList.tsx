import credits from '../content/reference-credits.json'
import { unnamedDishes } from '../content/menu'
import { shots } from '../content/shots'
import { Photo } from '../components/ui'

type C = { title: string; creator: string; license: string; license_url: string; landing: string; provider: string }

/** Prototype-only page for Sergio: what each photo on the site should look like, and how to shoot his own. Not in the production build. */
export function ShotList() {
  return (
    <section className="wrap py-12 md:py-16">
      <h1 className="text-4xl sm:text-5xl">Photo shot list</h1>
      <div className="mt-5 max-w-prose space-y-3 text-lg text-ink-muted">
        <p>
          Every photo on this prototype is someone else's picture, watermarked so it can't end up on the real site. Each one shows the
          look a slot needs. The launch version uses only Sergio's own photos, shot to these specs.
        </p>
        <p>
          One shoot at a real event covers most of this list: a half day with a local food photographer, or a careful phone shoot in
          daylight. Get written permission from every guest who appears.
        </p>
      </div>
      <ol className="mt-12 space-y-14">
        {shots.map((s, i) => {
          const c = (credits as Record<string, C>)[s.slot]
          return (
            <li key={s.slot} className="grid gap-6 border-t border-rule pt-8 md:grid-cols-[18rem_1fr]">
              <Photo slot={s.slot} alt={`Reference for ${s.slot}`} sizes="18rem" className="aspect-[4/5] w-full rounded-card" />
              <div className="max-w-prose">
                <h2 className="text-2xl">
                  {i + 1}. {s.slot}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Used on: {s.use}. Shape: {s.aspect}.
                </p>
                <p className="mt-3">{s.spec}</p>
                {c && (
                  <p className="mt-3 text-sm text-ink-muted">
                    Reference: “{c.title}” by {c.creator || 'unknown'}, {c.license.toUpperCase()} via {c.provider}.{' '}
                    <a className="link" href={c.landing}>
                      Source
                    </a>
                    {c.license_url && (
                      <>
                        {' · '}
                        <a className="link" href={c.license_url}>
                          License
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <h2 className="mt-16 text-3xl">Dishes in the old photos that need names</h2>
      <p className="mt-3 max-w-prose text-ink-muted">These appear in the current site's pictures but never by name. If they're on his menu, he names them and they join the dish list.</p>
      <ul className="mt-4 list-disc space-y-1 pl-6">
        {unnamedDishes.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </section>
  )
}
