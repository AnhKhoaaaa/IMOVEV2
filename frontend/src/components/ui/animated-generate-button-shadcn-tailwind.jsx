import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'

const ACTION_DELAY_AFTER_APPEAR_MS = 520

function LetterRow({ label, rowRef, hidden = false }) {
  return (
    <span
      ref={rowRef}
      aria-hidden="true"
      className="ui-particle-letter-row absolute flex whitespace-nowrap"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      {Array.from(label).map((character, index) => (
        <span
          key={`${character}-${index}`}
          className="ui-particle-letter relative inline-block"
          style={{ '--ui-letter-delay': `${index * 0.08}s` }}
        >
          {character === ' ' ? '\u00a0' : character}
        </span>
      ))}
    </span>
  )
}

export default function AnimatedGenerateButton({
  className,
  labelIdle = 'Generate',
  labelActive = 'Building',
  generating = false,
  highlightHueDeg = 210,
  onClick,
  type = 'button',
  disabled = false,
  id,
  ariaLabel,
}) {
  const [animating, setAnimating] = useState(false)
  const [active, setActive] = useState(generating)
  const idleRef = useRef(null)
  const activeRef = useRef(null)
  const particlesRef = useRef(new Set())
  const timersRef = useRef(new Set())

  const schedule = (callback, delay) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      callback()
    }, delay)
    timersRef.current.add(timer)
  }

  useEffect(() => {
    if (generating) setActive(true)
  }, [generating])

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout)
    particlesRef.current.forEach((particle) => particle.remove())
  }, [])

  const spawnParticles = (letter, count) => {
    const rect = letter.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const color = `hsl(${highlightHueDeg}, 100%, 62%)`
    const fragment = document.createDocumentFragment()
    const particleAnimations = []

    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement('span')
      const size = 1.5 + Math.random() * 2
      const angle = Math.random() * Math.PI * 2
      const distance = 28 + Math.random() * 62
      const destinationX = Math.cos(angle) * distance
      const destinationY = Math.sin(angle) * distance - 15 + Math.random() * 20
      const gravityY = destinationY + 18 + Math.random() * 20
      const duration = 480 + Math.random() * 280

      particle.className = 'ui-fixed-particle'
      particle.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        left: ${centerX}px;
        top: ${centerY}px;
        background: ${color};
        box-shadow: 0 0 ${Math.min(size * 1.5, 4)}px ${color};
      `
      fragment.appendChild(particle)
      particlesRef.current.add(particle)
      particleAnimations.push({ particle, destinationX, destinationY, gravityY, duration })
    }

    document.body.appendChild(fragment)

    particleAnimations.forEach(({ particle, destinationX, destinationY, gravityY, duration }) => {
      if (typeof particle.animate !== 'function') {
        schedule(() => {
          particle.remove()
          particlesRef.current.delete(particle)
        }, duration)
        return
      }

      const animation = particle.animate(
        [
          { opacity: 1, transform: 'translate3d(-50%, -50%, 0) scale(1)' },
          {
            opacity: 0.72,
            transform: `translate3d(calc(-50% + ${destinationX * 0.7}px), calc(-50% + ${destinationY * 0.7}px), 0) scale(0.72)`,
            offset: 0.68,
          },
          {
            opacity: 0,
            transform: `translate3d(calc(-50% + ${destinationX}px), calc(-50% + ${gravityY}px), 0) scale(0.18)`,
          },
        ],
        { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
      )

      animation.onfinish = () => {
        particle.remove()
        particlesRef.current.delete(particle)
      }
    })
  }

  const appearIn = (container) => {
    const letters = Array.from(container?.querySelectorAll('.ui-particle-letter') ?? [])
    if (!container) return
    container.style.opacity = '1'

    letters.forEach((letter) => {
      letter.style.opacity = '0'
      letter.style.transform = 'translateY(8px) scale(0.7)'
      letter.style.transition = 'none'
    })

    letters.forEach((letter, index) => {
      schedule(() => {
        letter.style.transition = 'opacity 0.25s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.5s, text-shadow 0.5s'
        letter.style.opacity = '1'
        letter.style.transform = 'translateY(0) scale(1)'
        letter.style.color = `hsl(${highlightHueDeg}, 100%, 42%)`
        letter.style.textShadow = `0 0 6px hsl(${highlightHueDeg}, 100%, 62%)`
        schedule(() => {
          letter.style.color = ''
          letter.style.textShadow = ''
        }, 350)
      }, index * 45)
    })
  }

  const dissolveOut = (container, onDone) => {
    const letters = Array.from(container?.querySelectorAll('.ui-particle-letter') ?? [])
    if (!letters.length) {
      onDone()
      return
    }

    letters.forEach((letter, index) => {
      schedule(() => {
        spawnParticles(letter, 6)
        letter.style.animation = 'none'
        letter.style.transition = 'opacity 0.18s, transform 0.22s'
        letter.style.opacity = '0'
        letter.style.transform = 'translateY(-6px) scale(0.6)'

        if (index === letters.length - 1) {
          schedule(onDone, 250)
        }
      }, index * 38)
    })
  }

  const handleClick = (event) => {
    if (disabled || generating || animating || active) return
    event.persist?.()
    setAnimating(true)

    dissolveOut(idleRef.current, () => {
      if (idleRef.current) idleRef.current.style.opacity = '0'
      setActive(true)
      appearIn(activeRef.current)
      schedule(() => {
        setAnimating(false)
        onClick?.(event)
      }, ACTION_DELAY_AFTER_APPEAR_MS)
    })
  }

  return (
    <div className={clsx('ui-particle-btn-wrap relative inline-block', className)} id={id}>
      <button
        type={type}
        aria-label={ariaLabel || (active || generating ? labelActive : labelIdle)}
        aria-pressed={active || generating}
        aria-busy={animating || generating}
        disabled={disabled}
        onClick={handleClick}
        className={clsx(
          'ui-particle-btn relative flex h-10 w-full select-none items-center justify-center',
          'rounded-[24px] border border-blue-200 bg-white px-4 py-2 text-blue-950',
          (animating || generating) && 'is-generating',
        )}
        style={{ '--ui-particle-hue': highlightHueDeg }}
      >
        <span className="sr-only">{active || generating ? labelActive : labelIdle}</span>
        <svg className="ui-particle-svg mr-2 h-5 w-5 flex-grow-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
        </svg>

        <span className="relative flex h-5 min-w-[6.4em] items-center text-[13px] font-extrabold">
          <LetterRow label={labelIdle} rowRef={idleRef} hidden={active || generating} />
          <LetterRow label={labelActive} rowRef={activeRef} hidden={!active && !generating} />
        </span>
      </button>

      <style>{`
        .ui-fixed-particle {
          position: fixed;
          z-index: 9999;
          border-radius: 50%;
          pointer-events: none;
          opacity: 1;
          contain: strict;
          transform: translate3d(-50%, -50%, 0);
          will-change: transform, opacity;
        }

        .ui-particle-btn {
          --ui-highlight: hsl(var(--ui-particle-hue), 100%, 62%);
          cursor: pointer;
          overflow: visible;
          outline: none;
          box-shadow:
            inset 0 1px 1px white,
            inset 0 -8px 18px -16px var(--ui-highlight),
            0 10px 22px -16px var(--ui-highlight);
          transition: box-shadow 0.4s, border-color 0.4s, background-color 0.4s, transform 0.2s;
        }

        .ui-particle-btn::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          background: linear-gradient(0deg, white, var(--ui-highlight), transparent 42%);
          opacity: 0;
          transition: opacity 0.4s;
          -webkit-mask-image: linear-gradient(0deg, #fff, transparent);
          mask-image: linear-gradient(0deg, #fff, transparent);
        }

        .ui-particle-btn:hover,
        .ui-particle-btn:focus-visible {
          border-color: var(--ui-highlight);
          background: #eff6ff;
          transform: translateY(-1px);
        }

        .ui-particle-btn:hover::after,
        .ui-particle-btn:focus-visible::after {
          opacity: 0.38;
        }

        .ui-particle-letter {
          color: #1e3a8a;
          animation: ui-particle-letter-glow 2s ease-in-out infinite;
          animation-delay: var(--ui-letter-delay);
        }

        @keyframes ui-particle-letter-glow {
          50% {
            color: #2563eb;
            text-shadow: 0 0 4px hsla(var(--ui-particle-hue), 100%, 55%, 0.4);
          }
        }

        .ui-particle-svg {
          fill: #2563eb;
          filter: drop-shadow(0 0 2px hsla(var(--ui-particle-hue), 100%, 55%, 0.45));
          animation: ui-particle-flicker 2s linear infinite 0.5s;
          transition: fill 0.4s, filter 0.4s, opacity 0.3s;
        }

        .ui-particle-btn.is-generating .ui-particle-svg {
          animation: ui-particle-spin 1.2s linear infinite;
          fill: var(--ui-highlight);
          filter: drop-shadow(0 0 4px var(--ui-highlight));
        }

        .ui-particle-btn.is-generating .ui-particle-letter {
          animation: none;
        }

        @keyframes ui-particle-flicker {
          50% { opacity: 0.3; }
        }

        @keyframes ui-particle-spin {
          to { transform: rotate(360deg); }
        }

        .ui-particle-btn:disabled {
          cursor: not-allowed;
          opacity: 0.5;
          transform: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .ui-particle-letter,
          .ui-particle-svg {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
