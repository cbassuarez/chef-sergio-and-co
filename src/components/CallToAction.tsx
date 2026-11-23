import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'

type CtaLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  emphasis: 'primary' | 'secondary'
}

/** Navigation CTAs retain native links, including keyboard and no-JavaScript behavior. */
export function CtaLink({ emphasis, className = '', ...props }: CtaLinkProps) {
  return <a {...props} className={`cta-link cta-link--${emphasis} ${className}`.trim()} />
}

type CtaButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  emphasis: 'primary' | 'secondary'
}

/** Form actions share the visual family while keeping native submit/disabled semantics. */
export function CtaButton({ emphasis, className = '', type = 'button', ...props }: CtaButtonProps) {
  return <button {...props} type={type} className={`cta-link cta-link--${emphasis} ${className}`.trim()} />
}
