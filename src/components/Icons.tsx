import { createElement, type SVGProps } from 'react'
import { iconNodes, type IconName } from '../vendor/lucide/nodes'

export type { IconName } from '../vendor/lucide/nodes'

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> & {
  name: IconName
  size?: number | string
}

/** Vendored Lucide subset. Icons supplement a visible label and are decorative by default. */
export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.75,
  'aria-hidden': ariaHidden = true,
  focusable = false,
  ...props
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['icon', `icon-${name}`, className].filter(Boolean).join(' ')}
      aria-hidden={ariaHidden}
      focusable={focusable}
      {...props}
    >
      {iconNodes[name].map(([tag, attributes], index) => createElement(tag, { ...attributes, key: index }))}
    </svg>
  )
}
