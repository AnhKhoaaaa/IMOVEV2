import { useEffect, useState } from 'react'
import { ArrowRight, MapPinned, RadioTower, Route } from 'lucide-react'
import { cn } from '../../lib/utils'
import { RippleButton } from './ripple-button'
import { GlowCard } from './spotlight-card'

const FEATURE_ICONS = [MapPinned, Route, RadioTower]
const FEATURE_GLOWS = ['blue', 'purple', 'green']

export function ImageCarouselHero({
  title,
  description,
  ctaText,
  secondaryCtaText,
  onCtaClick,
  onSecondaryCtaClick,
  images,
  features = [],
}) {
  const [mousePosition, setMousePosition] = useState({ x: 0.5, y: 0.5 })
  const [isHovering, setIsHovering] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [compactOrbit, setCompactOrbit] = useState(false)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRotation((current) => (current + (isHovering ? 0.08 : 0.22)) % 360)
    }, 50)
    return () => window.clearInterval(interval)
  }, [isHovering])

  useEffect(() => {
    const updateOrbit = () => setCompactOrbit(window.innerWidth < 640)
    updateOrbit()
    window.addEventListener('resize', updateOrbit)
    return () => window.removeEventListener('resize', updateOrbit)
  }, [])

  const handleMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMousePosition({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    })
  }

  return (
    <section className="home-carousel-hero relative isolate overflow-hidden border-b border-slate-100 bg-[#f8f9fa] text-[#191c1d]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-200 to-transparent" />
      <div className="pointer-events-none absolute -left-32 top-16 h-80 w-80 rounded-full bg-[#d8e2ff]/70 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-8 h-96 w-96 rounded-full bg-[#dce2f7]/65 blur-3xl" />

      <div className="relative z-10 mx-auto grid min-h-[690px] max-w-7xl items-center gap-12 px-5 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:px-16 lg:py-16">
        <div className="max-w-[560px]">
          <h1 className="font-sans text-[40px] font-bold leading-[48px] tracking-[-0.02em] text-[#111827] sm:text-[48px] sm:leading-[56px]">
            {title}
          </h1>
          <p className="mt-6 max-w-lg text-[16px] leading-7 text-[#6b7280] sm:text-[18px]">
            {description}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <RippleButton
              type="button"
              onClick={onCtaClick}
              hoverRippleColor="#0369a1"
              className="group inline-flex h-12 items-center justify-center rounded-lg bg-[#3b82f6] px-6 text-[14px] font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-[#adc6ff] focus:ring-offset-2"
            >
              {ctaText}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </RippleButton>
            {secondaryCtaText && (
              <RippleButton
                type="button"
                onClick={onSecondaryCtaClick}
                hoverRippleColor="#d8e2ff"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-[#e5e7eb] bg-transparent px-6 text-[14px] font-semibold text-[#111827] transition hover:border-[#c2c6d6] focus:outline-none focus:ring-2 focus:ring-[#d8e2ff] focus:ring-offset-2"
              >
                {secondaryCtaText}
              </RippleButton>
            )}
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length]
              return (
                <GlowCard
                  key={feature.title}
                  glowColor={FEATURE_GLOWS[index % FEATURE_GLOWS.length]}
                  className="rounded-xl bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#eff6ff]">
                    <Icon className="h-4 w-4 text-[#0058be]" />
                  </div>
                  <h2 className="mt-4 text-[14px] font-semibold leading-5 text-[#191c1d]">{feature.title}</h2>
                  <p className="mt-2 text-[12px] leading-4 text-[#6b7280]">{feature.description}</p>
                </GlowCard>
              )
            })}
          </div>
        </div>

        <div
          className="relative mx-auto h-[430px] w-full max-w-[600px] overflow-hidden sm:h-[520px] lg:overflow-visible"
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <div className="absolute inset-0 flex items-center justify-center [perspective:1000px]">
            {images.map((image, index) => {
              const angleDegrees = rotation + index * (360 / images.length)
              const angle = angleDegrees * (Math.PI / 180)
              const radiusX = compactOrbit ? 132 : 220
              const radiusY = compactOrbit ? 142 : 174
              const x = Math.cos(angle) * radiusX
              const y = Math.sin(angle) * radiusY
              const depthScale = 0.82 + ((Math.sin(angle) + 1) / 2) * 0.22
              const perspectiveX = (mousePosition.x - 0.5) * 12
              const perspectiveY = (mousePosition.y - 0.5) * -12

              return (
                <div
                  key={image.id}
                  className="absolute h-36 w-28 transition-transform duration-300 sm:h-44 sm:w-36"
                  style={{
                    zIndex: Math.round((Math.sin(angle) + 1) * 10),
                    transform: `translate(${x}px, ${y}px) scale(${depthScale}) rotateX(${perspectiveY}deg) rotateY(${perspectiveX}deg) rotateZ(${image.rotation}deg)`,
                    transformStyle: 'preserve-3d',
                  }}
                >
                  <div className={cn(
                    'group relative h-full w-full cursor-pointer overflow-hidden rounded-2xl border border-white/20 bg-slate-800 shadow-2xl',
                    'transition duration-300 hover:scale-110 hover:border-sky-200/60 hover:shadow-[0_20px_50px_-18px_rgba(56,189,248,0.75)]',
                  )}>
                    <img
                      src={image.src}
                      alt={image.alt}
                      loading={index < 3 ? 'eager' : 'lazy'}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-slate-950/20 opacity-70" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
