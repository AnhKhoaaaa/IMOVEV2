import { cn } from '../../lib/utils'

export function RippleButton({
  children,
  className,
  hoverRippleColor = '#0369a1',
  style,
  ...props
}) {
  return (
    <button
      className={cn('ripple-button', className)}
      style={{ '--hover-ripple-color': hoverRippleColor, ...style }}
      {...props}
    >
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </button>
  )
}
