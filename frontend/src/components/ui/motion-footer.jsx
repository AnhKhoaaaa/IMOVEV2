import { forwardRef, useEffect, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { cn } from '../../lib/utils'
import { useLang } from '../../contexts/LanguageContext'

gsap.registerPlugin(ScrollTrigger)

const MagneticButton = forwardRef(function MagneticButton(
  { className, children, as: Component = 'button', ...props },
  forwardedRef,
) {
  const localRef = useRef(null)

  useEffect(() => {
    const element = localRef.current
    if (!element) return undefined

    const handleMouseMove = (event) => {
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left - rect.width / 2
      const y = event.clientY - rect.top - rect.height / 2
      gsap.to(element, {
        x: x * 0.4,
        y: y * 0.4,
        rotationX: -y * 0.15,
        rotationY: x * 0.15,
        scale: 1.05,
        ease: 'power2.out',
        duration: 0.4,
      })
    }

    const handleMouseLeave = () => {
      gsap.to(element, {
        x: 0,
        y: 0,
        rotationX: 0,
        rotationY: 0,
        scale: 1,
        ease: 'elastic.out(1, 0.3)',
        duration: 1.2,
      })
    }

    element.addEventListener('mousemove', handleMouseMove)
    element.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      element.removeEventListener('mousemove', handleMouseMove)
      element.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  return (
    <Component
      ref={(node) => {
        localRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      className={cn('cursor-pointer', className)}
      {...props}
    >
      {children}
    </Component>
  )
})

function MarqueeItem() {
  return (
    <div className="flex items-center space-x-12 px-6">
      <span>Plan with Confidence</span><span className="text-blue-500/60">●</span>
      <span>Live Transport Awareness</span><span className="text-slate-500/60">●</span>
      <span>Personalized Routes</span><span className="text-blue-500/60">●</span>
      <span>Explore Singapore</span><span className="text-slate-500/60">●</span>
      <span>Adapt While Moving</span><span className="text-blue-500/60">●</span>
    </div>
  )
}

export function CinematicFooter() {
  const { lang } = useLang()
  const wrapperRef = useRef(null)
  const giantTextRef = useRef(null)
  const headingRef = useRef(null)
  const linksRef = useRef(null)

  useEffect(() => {
    if (!wrapperRef.current) return undefined
    const ctx = gsap.context(() => {
      gsap.fromTo(
        giantTextRef.current,
        { y: '10vh', scale: 0.8, opacity: 0 },
        {
          y: '0vh',
          scale: 1,
          opacity: 1,
          ease: 'power1.out',
          scrollTrigger: {
            trigger: wrapperRef.current,
            start: 'top 80%',
            end: 'bottom bottom',
            scrub: 1,
          },
        },
      )
      gsap.fromTo(
        [headingRef.current, linksRef.current],
        { y: 50, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          stagger: 0.15,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: wrapperRef.current,
            start: 'top 40%',
            end: 'bottom bottom',
            scrub: 1,
          },
        },
      )
    }, wrapperRef)
    return () => ctx.revert()
  }, [])

  return (
    <div
      ref={wrapperRef}
      className="motion-footer-wrapper relative h-screen w-full"
      style={{ clipPath: 'polygon(0% 0, 100% 0%, 100% 100%, 0 100%)' }}
    >
      <footer className="motion-footer fixed bottom-0 left-0 flex h-screen w-full flex-col justify-between overflow-hidden bg-white text-slate-950">
        <div className="motion-footer-aurora absolute left-1/2 top-1/2 z-0 h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-[50%] blur-[80px]" />
        <div className="motion-footer-grid absolute inset-0 z-0" />

        <div ref={giantTextRef} className="motion-footer-giant-text pointer-events-none absolute -bottom-[5vh] left-1/2 z-0 -translate-x-1/2 select-none whitespace-nowrap">
          IMOVE
        </div>

        <div className="absolute left-0 top-12 z-10 w-full -rotate-2 scale-110 overflow-hidden border-y border-slate-200/70 bg-white/65 py-4 shadow-xl backdrop-blur-md">
          <div className="motion-footer-marquee-track flex w-max text-xs font-bold uppercase tracking-[0.3em] text-slate-500 md:text-sm">
            <MarqueeItem />
            <MarqueeItem />
          </div>
        </div>

        <div className="relative z-10 mx-auto mt-20 flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6">
          <h2 ref={headingRef} className="motion-footer-heading mb-12 text-center text-5xl font-black tracking-tighter md:text-8xl">
            {lang === 'vi' ? 'Sẵn sàng bắt đầu?' : 'Ready to begin?'}
          </h2>

          <div ref={linksRef} className="flex w-full flex-col items-center gap-6">
            <div className="flex w-full flex-wrap justify-center gap-3 md:gap-6">
              <MagneticButton as="a" href="/privacy" className="motion-footer-pill px-6 py-3 text-xs font-medium text-slate-600 hover:text-slate-950 md:text-sm">
                {lang === 'vi' ? 'Chính sách Bảo mật' : 'Privacy Policy'}
              </MagneticButton>
              <MagneticButton as="a" href="/terms" className="motion-footer-pill px-6 py-3 text-xs font-medium text-slate-600 hover:text-slate-950 md:text-sm">
                {lang === 'vi' ? 'Điều khoản Dịch vụ' : 'Terms of Service'}
              </MagneticButton>
              <MagneticButton as="a" href="/support" className="motion-footer-pill px-6 py-3 text-xs font-medium text-slate-600 hover:text-slate-950 md:text-sm">
                {lang === 'vi' ? 'Hỗ trợ' : 'Support'}
              </MagneticButton>
            </div>
          </div>
        </div>

        <div className="relative z-20 flex w-full flex-col items-center justify-between gap-6 px-6 pb-8 md:flex-row md:px-12">
          <div className="order-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 md:order-2 md:text-xs">
            {lang === 'vi' ? '2026 IMOVE. Bảo lưu mọi quyền.' : '2026 IMOVE. All rights reserved.'}
          </div>
          <MagneticButton
            as="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="motion-footer-pill group order-1 flex h-12 w-12 self-start items-center justify-center text-slate-500 hover:text-slate-950 md:order-1 md:self-auto"
            aria-label="Back to top"
          >
            <ArrowUp className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-1.5" />
          </MagneticButton>
        </div>
      </footer>
    </div>
  )
}
