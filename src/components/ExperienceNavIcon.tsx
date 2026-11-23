import { m } from 'framer-motion'

type ExperienceNavIconProps = {
  active: boolean
  mobile?: boolean
  reduced?: boolean
}

type Point = readonly [number, number]

// A line expressed as cubic segments shares the same topology as the utensil
// curves. Motion can therefore replace the actual path data continuously.
const line = (from: Point, to: Point, segments: number) => {
  const point = (part: number) => `${from[0] + (to[0] - from[0]) * part} ${from[1] + (to[1] - from[1]) * part}`
  let path = `M${point(0)}`
  for (let segment = 0; segment < segments; segment++) {
    path += ` C${point((segment + 1 / 3) / segments)} ${point((segment + 2 / 3) / segments)} ${point((segment + 1) / segments)}`
  }
  return path
}

// Cubic equivalents of the existing Lucide crossed utensils. Curved fork and
// knife outlines retain their familiar resting silhouette at the original size.
const utensils = [
  'M16 2 C15.2333 2.7667 14.4667 3.5333 13.7 4.3 C12.54 5.46 12.54 7.34 13.7 8.5 C14.3 9.1 14.9 9.7 15.5 10.3 C16.66 11.46 18.54 11.46 19.7 10.3 C20.4667 9.5333 21.2333 8.7667 22 8',
  'M15 15 C11.1 11.1 7.2 7.2 3.3 3.3 C1.64 4.96 1.64 7.64 3.3 9.3 C5.7333 11.7333 8.1667 14.1667 10.6 16.6 C11.3 17.3 12.6 17.3 13.4 16.6 C13.9333 16.0667 14.4667 15.5333 15 15 C15 15 15 15 15 15 C17.3333 17.3333 19.6667 19.6667 22 22',
  line([2.1, 21.8], [8.5, 15.5], 1),
  line([19, 5], [12, 12], 1),
] as const

const utensilChevron = [
  line([18, 9], [15, 12], 5),
  line([6, 9], [9, 12], 7),
  line([9, 12], [12, 15], 1),
  line([15, 12], [12, 15], 1),
] as const

const menu = [line([4, 6], [20, 6], 1), line([4, 12], [20, 12], 1), line([4, 18], [20, 18], 1)] as const
const menuChevron = [line([6, 9], [12, 15], 1), line([12, 15], [18, 9], 1), line([12, 15], [12, 15], 1)] as const
const transition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const }

/** A path replacement, with no crossfade, size change, or idle animation. */
export function ExperienceNavIcon({ active, mobile = false, reduced = false }: ExperienceNavIconProps) {
  const rest = mobile ? menu : utensils
  const dropdown = mobile ? menuChevron : utensilChevron
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" data-experience-icon={active ? 'dropdown' : 'rest'}>
      {rest.map((path, index) => reduced
        ? <path key={index} d={active ? dropdown[index] : path} />
        : <m.path key={index} initial={false} d={path} animate={{ d: active ? dropdown[index] : path }} transition={transition} />)}
    </svg>
  )
}
