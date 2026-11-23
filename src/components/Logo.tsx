import { site } from '../content/site'
import { href } from './ui'
import './Logo.css'

type LogoProps = {
  variant?: 'primary' | 'compact' | 'responsive'
  reversed?: boolean
  decorative?: boolean
  className?: string
}

/** Fixed, outlined artwork: the compact optical drawing replaces the full mark on phones. */
export function Logo({ variant = 'primary', reversed = false, decorative = false, className = '' }: LogoProps) {
  const tone = reversed ? 'reverse' : 'ink'
  const asset = (kind: 'primary' | 'compact') => href(`/brand/logo-${kind}-${tone}.svg?v=salon-1`)
  const compact = variant === 'compact'
  return (
    <picture className={`brand-logo brand-logo--${variant} ${className}`.trim()} data-brand-logo={variant}>
      {variant === 'responsive' && <source media="(max-width: 700px)" type="image/svg+xml" srcSet={asset('compact')} />}
      <img src={asset(compact ? 'compact' : 'primary')} alt={decorative ? '' : site.name}
        width={compact ? 273 : 426} height={compact ? 43 : 65} draggable={false} />
    </picture>
  )
}
