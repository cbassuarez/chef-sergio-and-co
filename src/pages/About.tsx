import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CtaLink } from '../components/CallToAction'
import { href, track } from '../components/ui'
import { about, type AboutPhoto } from '../content/about'
import { IS_PROTOTYPE } from '../content/site'

type StoryMedia = AboutPhoto

/** A real image opens accessibly; without JavaScript, its link still opens the original. */
export function StoryImage({ media, slot, label, className = '', priority = false }: { media: StoryMedia; slot: string; label: string; className?: string; priority?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!media.image) {
    return (
      <figure className={`about-figure ${className}`}>
        <div className="about-photo-pending" data-tbd={`about.photo.${slot}`} role="img" aria-label={`Photograph pending: ${media.alt}`}>
          <span className="about-photo-label">{label}</span>
          <span className="about-caption">Photograph to come</span>
        </div>
        <figcaption className="about-caption">{media.caption}</figcaption>
      </figure>
    )
  }
  const image = media.image
  return (
    <figure className={`about-figure ${className}`} data-placeholder-figure={image.placeholder} data-tbd={image.placeholder ? 'photo.sergio-portrait' : undefined}>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <a className="about-image-link" href={href(image.src)} aria-label={`Enlarge ${label}`} onClick={(event) => { event.preventDefault(); setOpen(true); track('about_image_open', { image: slot }) }}>
            <img src={href(image.src)} srcSet={image.sources?.map(source => `${href(source.src)} ${source.width}w`).join(', ')}
              sizes="(min-width: 1248px) 490px, (min-width: 768px) 42vw, calc(100vw - 3rem)"
              width={image.width} height={image.height} alt={media.alt} loading={priority ? 'eager' : 'lazy'} decoding="async" data-placeholder={image.placeholder} />
            <span className="about-image-hint">View photograph</span>
          </a>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="about-lightbox-overlay" />
          <Dialog.Content className="about-theme about-lightbox">
            <div className="about-lightbox-heading">
              <Dialog.Title>{label}</Dialog.Title>
              <Dialog.Close className="about-close">Close</Dialog.Close>
            </div>
            <img src={href(image.src)} width={image.width} height={image.height} alt={media.alt} data-placeholder={image.placeholder} />
            <Dialog.Description className="about-caption">{media.caption}</Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <figcaption className="about-caption">{media.caption}</figcaption>
    </figure>
  )
}

export function About() {
  const { chapters, assets } = about
  return (
    <article className="about-page" aria-labelledby="about-heading">
      <section className="about-wrap about-hero">
        <div className="about-hero-copy">
          <p className="about-eyebrow">The chef behind your evening</p>
          <h1 id="about-heading">A lifetime in the kitchen.<br /><span>Now at your table.</span></h1>
          <p className="about-intro">{about.intro}</p>
          <div className="about-hero-actions cta-pair">
            <CtaLink emphasis="primary" data-hero-cta href={href('/book/')} onClick={() => track('cta_check_date', { where: 'about_hero' })}>{about.closing.primaryLabel}</CtaLink>
            <CtaLink emphasis="secondary" href={`#${chapters.cedac.id}`}>Read Sergio’s story</CtaLink>
          </div>
        </div>
        <StoryImage media={assets.portrait} slot="portrait" label="Sergio, in his kitchen." className="about-portrait" priority />
      </section>

      <nav className="about-wrap about-chapters" aria-label="Sergio’s story">
        {Object.values(chapters).map((chapter) => <a href={`#${chapter.id}`} key={chapter.id}>{chapter.navLabel}</a>)}
      </nav>

      <section className="about-wrap about-chapter about-cedac" id={chapters.cedac.id} aria-labelledby="cedac-heading">
        <div className="about-chapter-copy">
          <p className="about-eyebrow">{chapters.cedac.eyebrow}</p>
          <h2 id="cedac-heading">{chapters.cedac.title}</h2>
          {chapters.cedac.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <CtaLink emphasis="secondary" className="about-text-link" href={href('/cookingclasses/')}>Explore cooking classes</CtaLink>
        </div>
        <StoryImage media={assets.cedac} slot="cedac" label="The CeDAC years." className="about-school-photo" />
      </section>

      <section className="about-mia" id={chapters.miaPizza.id} aria-labelledby="mia-heading">
        <div className="about-wrap about-chapter">
          <div className="about-chapter-copy">
            <p className="about-eyebrow">{chapters.miaPizza.eyebrow}</p>
            <h2 id="mia-heading">{chapters.miaPizza.title}</h2>
            {chapters.miaPizza.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            <p className="about-tenure"><span>21+</span><span>years as owner<br />of Mia Pizza</span></p>
          </div>
          <StoryImage media={assets.miaPizza} slot="mia-pizza" label="Behind the counter at Mia Pizza." className="about-mia-photo" />
        </div>
      </section>

      <section className="about-wrap about-archive" id={chapters.archive.id} aria-labelledby="archive-heading">
        <div className="about-archive-intro">
          <p className="about-eyebrow">{chapters.archive.eyebrow}</p>
          <h2 id="archive-heading">{chapters.archive.title}</h2>
          {chapters.archive.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <ul className="about-certificates" aria-label="Culinary credentials">
          {assets.certificates.map((certificate) => (
            <li className="about-certificate" key={certificate.id}>
              {certificate.image
                ? <StoryImage media={certificate} slot={certificate.id} label={`${certificate.organization}, ${certificate.year}`} className="about-certificate-image" />
                : <div className="about-certificate-pending" data-tbd={`about.certificate.${certificate.id}`}><span className="about-caption">Original certificate</span><span className="about-certificate-year">{certificate.year}</span><span className="about-caption">Scan to come</span></div>}
              <h3>{certificate.organization}</h3>
              <p className="about-caption">{certificate.title}, issued in {certificate.year}.</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="about-today" id={chapters.atYourTable.id} aria-labelledby="today-heading">
        <div className="about-wrap about-chapter">
          <div className="about-chapter-copy">
            <p className="about-eyebrow">{chapters.atYourTable.eyebrow}</p>
            <h2 id="today-heading">{chapters.atYourTable.title}</h2>
            {chapters.atYourTable.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          <div className="about-today-invitation">
            <p className="about-eyebrow">An invitation</p>
            <h3>{about.closing.title}</h3>
            <p>{about.closing.text}</p>
            <div className="about-invitation-actions cta-pair cta-pair--vertical">
              <CtaLink emphasis="primary" href={href('/book/')} onClick={() => track('cta_check_date', { where: 'about_closing' })}>{about.closing.primaryLabel}</CtaLink>
              <CtaLink emphasis="secondary" href={href('/cookingclasses/')}>{about.closing.secondaryLabel}</CtaLink>
            </div>
          </div>
        </div>
      </section>
      {IS_PROTOTYPE && <aside className="about-wrap about-editor-note" aria-label="Photography for this page">A final portrait, CeDAC and Mia Pizza photographs, and original certificate scans will complete this page.</aside>}
    </article>
  )
}
