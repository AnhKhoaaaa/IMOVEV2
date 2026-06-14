import { useRef } from 'react'
import { cn } from '../../lib/utils'

const GLOW_COLORS = {
  blue: '59 130 246',
  purple: '139 92 246',
  green: '16 185 129',
  red: '239 68 68',
  orange: '249 115 22',
}

export function GlowCard({
  children,
  className,
  glowColor = 'blue',
}) {
  const cardRef = useRef(null)

  const syncPointer = (event) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect || !cardRef.current) return
    cardRef.current.style.setProperty('--spot-x', `${event.clientX - rect.left}px`)
    cardRef.current.style.setProperty('--spot-y', `${event.clientY - rect.top}px`)
  }

  return (
    <article
      ref={cardRef}
      onPointerMove={syncPointer}
      style={{ '--glow-rgb': GLOW_COLORS[glowColor] ?? GLOW_COLORS.blue }}
      className={cn('spotlight-card', className)}
    >
      <div className="spotlight-card__glow" aria-hidden="true" />
      <div className="relative z-10">{children}</div>
    </article>
  )
}
