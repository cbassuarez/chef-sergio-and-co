import { useEffect, useRef, useState, type MouseEventHandler, type PointerEvent as ReactPointerEvent } from 'react'
import { CtaButton, CtaLink } from './CallToAction'
import { Icon, type IconName } from './Icons'

type HeaderIconActionProps = {
  icon: IconName
  label: string
  emphasis?: 'primary' | 'secondary'
  className?: string
} & ({
  kind: 'link'
  href: string
  current?: boolean
  booking?: boolean
  onClick?: MouseEventHandler<HTMLAnchorElement>
} | {
  kind: 'button'
  closesNavigation?: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
})

/** Header actions retain native semantics and reveal the same label they announce. */
export function HeaderIconAction(props: HeaderIconActionProps) {
  const hint = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const showHint = (hovered || focused) && !dismissed

  useEffect(() => {
    if (!showHint) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !hint.current?.getClientRects().length) return
      // Dismiss the label before the enclosing navigation handles a second Escape.
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
    }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [showHint])

  const shared = {
    emphasis: props.emphasis ?? 'secondary',
    className: `sergio-header-icon-action ${props.className ?? ''}`.trim(),
    'aria-label': props.label,
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return
      setHovered(true)
      setDismissed(false)
    },
    onPointerLeave: () => setHovered(false),
    onFocus: () => { setFocused(true); setDismissed(false) },
    onBlur: () => setFocused(false),
    children: <>
      <Icon name={props.icon} size={22} />
      <span className={`sergio-header-action-hint${props.kind === 'link' && props.booking ? ' sergio-header-booking-hint' : ''}`}
        ref={hint} data-header-action-hint aria-hidden="true" hidden={!showHint}>
        <span>{props.label}</span>
      </span>
    </>,
  }

  return props.kind === 'link'
    ? <CtaLink {...shared} href={props.href} aria-current={props.current ? 'page' : undefined}
      data-header-booking={props.booking || undefined} onClick={props.onClick} />
    : <CtaButton {...shared} data-site-navigation-close={props.closesNavigation || undefined} onClick={props.onClick} />
}
