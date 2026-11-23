import { site } from './site'
import { sergioPortrait } from './portrait'

export type AboutImage = {
  /** Site-relative path, without a leading slash; resolved through href(). */
  src: string
  width: number
  height: number
  sources?: { src: string; width: number }[]
  placeholder?: 'sergio-portrait'
}

export type AboutPhoto = {
  image: AboutImage | null
  alt: string
  caption: string
  /** For the prototype/photo handoff only; never presented as biography copy. */
  shotBrief: string
}

export type AboutChapter = {
  id: 'cedac' | 'mia-pizza' | 'archive' | 'at-your-table'
  navLabel: string
  eyebrow: string
  title: string
  paragraphs: string[]
}

export type AboutCertificate = AboutPhoto & {
  id: string
  organization: string
  title: string
  year: number
}

/**
 * Biography provenance:
 * - CeDAC's founding by Sergio, its expanded name and Caracas location were
 *   supplied directly by the user on 22 November 2026. The possible 1990s
 *   founding date remains unconfirmed and is deliberately absent below.
 * - Mia Pizza ownership, Davenport location and a tenure exceeding 21 years
 *   were supplied directly by the user in the same conversation. No opening,
 *   closing, sale or transfer date has been established.
 * - Certificate organizations/titles/year come from the original site's
 *   captured facts in site.credentials. Original scans are still needed to
 *   establish exact inscriptions and whether either records a competition
 *   placing. Nothing below claims a second-place award or two separate wins.
 * - Today's service descriptions retain the existing private dining and
 *   cooking-class offers. No personal quotation or historical anecdote has
 *   been invented.
 *
 * The portrait is a user-supplied preview placeholder, separately registered in
 * content/photos.placeholders.json. Other images remain empty until supplied.
 * Register verified original photography/scans in content/photos.owned.json.
 */
export const about = {
  headline: 'A lifetime in the kitchen. Now at your table.',
  intro: 'Chef, culinary-school founder and longtime restaurateur. Sergio brings decades of experience to private dinners, cooking classes and small gatherings across Orlando and Central Florida.',
  opening: 'His story includes founding a culinary school in Caracas and owning Mia Pizza in Davenport for more than 21 years. Today, that working life takes a more personal form: a menu written around your guests, or a class where you cook alongside the chef.',
  chapters: {
    cedac: {
      id: 'cedac',
      navLabel: 'CeDAC, Caracas',
      eyebrow: 'A school in Caracas',
      title: 'A kitchen for learning.',
      paragraphs: [
        'Sergio founded CeDAC, the Centro de Artes Culinarias, in Caracas. Establishing a culinary school belongs alongside the restaurants in his story: a commitment to the craft of cooking and a place for others to learn it.',
        'That chapter brings another dimension to his work today. A cooking class offers a closer look at the decisions behind a dish, with room to ask questions and work through each preparation together. You take part in the cooking, then sit down to enjoy what you have made.',
      ],
    } satisfies AboutChapter,
    miaPizza: {
      id: 'mia-pizza',
      navLabel: 'Mia Pizza, Florida',
      eyebrow: 'Restaurant years in Davenport',
      title: 'More than two decades at Mia Pizza.',
      paragraphs: [
        'For over 21 years, Sergio owned Mia Pizza in Davenport, Florida. It was a substantial chapter of his working life, bringing together the responsibilities of a restaurant owner and the daily work of serving guests.',
        'That experience is part of what he brings to Chef Sergio & Co. A dinner involves the whole evening: planning the menu, preparing the food, serving it and taking care of the kitchen afterward. The host has time to be with the people they invited.',
      ],
    } satisfies AboutChapter,
    archive: {
      id: 'archive',
      navLabel: 'From the archive',
      eyebrow: 'Culinary diplomas from 1993',
      title: 'Pieces of a longer story.',
      paragraphs: [
        'Two culinary diplomas from 1993 form part of Sergio’s history: one from the American Culinary Federation and one from the National Capital Chefs Association in Washington, D.C.',
      ],
    } satisfies AboutChapter,
    atYourTable: {
      id: 'at-your-table',
      navLabel: 'Your table',
      eyebrow: 'Cooking with Sergio today',
      title: 'Experience, shared personally.',
      paragraphs: [
        'Every menu begins with a conversation about your tastes, your occasion and the people coming to the table. Sergio works with you to shape the meal, including dietary needs, then cooks in your kitchen, serves dinner and cleans up afterward.',
        'For a private dinner, that means you can stay with your guests while the cooking is taken care of. For a class, it means getting involved: preparing the food with Sergio, asking questions as you go and enjoying the meal together afterward.',
        'Whether you are gathering a few friends, celebrating with family or making time to learn something in your own kitchen, the starting point is personal. Tell Sergio what you have in mind, and begin planning it together.',
      ],
    } satisfies AboutChapter,
  },
  closing: {
    title: 'Plan something with Sergio.',
    text: 'An evening around your table, or time together in the kitchen. Start with your date and what you have in mind.',
    primaryLabel: 'Start planning',
    secondaryLabel: 'Explore cooking classes',
  },
  assets: {
    portrait: {
      image: sergioPortrait satisfies AboutImage,
      alt: sergioPortrait.alt,
      caption: sergioPortrait.caption,
      shotBrief: 'A current, relaxed portrait of Sergio in his own kitchen, at eye level in natural light. Portrait orientation, with breathing room around his head and hands.',
    } satisfies AboutPhoto,
    cedac: {
      image: null as AboutImage | null,
      alt: 'An archival photograph of CeDAC, the Centro de Artes Culinarias in Caracas',
      caption: 'Centro de Artes Culinarias in Caracas, Venezuela.',
      shotBrief: 'An original photograph of Sergio at CeDAC, a class, or the school itself. Preserve the photograph’s real colors and edges; confirm its subjects and date before captioning.',
    } satisfies AboutPhoto,
    miaPizza: {
      image: null as AboutImage | null,
      alt: 'An archival photograph of Mia Pizza in Davenport, Florida',
      caption: 'Mia Pizza in Davenport, Florida.',
      shotBrief: 'An original photograph of Sergio working at Mia Pizza, or of the restaurant during his ownership. Confirm the approximate date and who appears in the image.',
    } satisfies AboutPhoto,
    kitchen: {
      image: null as AboutImage | null,
      alt: 'Chef Sergio cooking alongside a guest in a home kitchen',
      caption: 'Cooking together, in your own kitchen.',
      shotBrief: 'A real current class or private dinner, showing Sergio’s hands and the food in context. Obtain permission from any identifiable guests. No stock or generated chef imagery.',
    } satisfies AboutPhoto,
    certificates: site.credentials.map((credential, index): AboutCertificate => ({
      id: `culinary-diploma-${index + 1}`,
      organization: credential.body,
      title: credential.title,
      year: credential.year,
      image: null,
      alt: `${credential.body} culinary diploma, ${credential.year}`,
      caption: `${credential.body} culinary diploma from ${credential.year}.`,
      shotBrief: 'A straight, evenly lit scan of the complete original document. All inscriptions, signatures, seals and edges must remain readable. Transcribe the exact title and any competition placing before publishing an award claim.',
    })),
  },
}
