import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  MapPin,
  Navigation2,
  RadioTower,
  Route,
  Search,
  Sparkles,
} from 'lucide-react'
import { CinematicFooter } from '../components/ui/motion-footer'

const JOURNEYS = [
  {
    title: 'Singapore Essentials',
    date: 'Jun 16 - Jun 18',
    meta: '3 days · 8 stops',
    status: 'Ready',
    image: '/imove-hero/supertree-grove.png',
  },
  {
    title: 'Culture after dark',
    date: 'Jun 22 - Jun 23',
    meta: '2 days · 6 stops',
    status: 'Upcoming',
    image: '/imove-hero/helix-bridge.png',
  },
  {
    title: 'Food and color',
    date: 'Flexible dates',
    meta: '1 day · 5 stops',
    status: 'Draft',
    image: '/imove-hero/haji-lane.png',
  },
]

function Reveal({ children, className = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.classList.add('is-visible')
          observer.disconnect()
        }
      },
      { threshold: 0.16 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={`preview-reveal ${className}`}>{children}</div>
}

export default function HomePreview() {
  const navigate = useNavigate()

  return (
    <div className="bg-white">
      <main className="relative z-10 overflow-hidden rounded-b-[32px] bg-white shadow-[0_30px_80px_-48px_rgba(15,23,42,0.32)]">
        <section className="preview-hero relative isolate min-h-[calc(100dvh-56px)] overflow-hidden bg-[#f8f9fa]">
          <div className="preview-hero-word pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none">
            SINGAPORE
          </div>
          <div className="absolute -left-32 top-20 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
          <div className="absolute -right-32 bottom-10 h-96 w-96 rounded-full bg-emerald-100/60 blur-3xl" />

          <div className="relative mx-auto grid min-h-[calc(100dvh-56px)] max-w-7xl items-center gap-14 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="preview-hero-copy">
              <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-700">
                <Sparkles className="h-3.5 w-3.5" /> Cinematic homepage preview
              </span>
              <h1 className="mt-7 max-w-xl font-sans text-[50px] font-black leading-[1.02] tracking-[-0.055em] text-slate-950 sm:text-[72px]">
                Singapore moves. Your plan moves with it.
              </h1>
              <p className="mt-7 max-w-lg text-[17px] leading-8 text-slate-500">
                A calmer, more cinematic way to plan routes, monitor live conditions, and discover what comes next.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <button onClick={() => navigate('/plan')} className="group flex h-12 items-center gap-2 rounded-lg bg-blue-600 px-6 text-[14px] font-bold text-white transition hover:-translate-y-1 hover:bg-blue-500">
                  Plan a new trip <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
                <button onClick={() => navigate('/')} className="h-12 rounded-lg border border-slate-200 bg-white px-6 text-[14px] font-bold text-slate-700 transition hover:-translate-y-1 hover:border-blue-200">
                  Return to current home
                </button>
              </div>
            </div>

            <div className="preview-photo-stage relative mx-auto h-[560px] w-full max-w-[620px]">
              <div className="absolute inset-x-12 bottom-7 top-7 overflow-hidden rounded-[36px] shadow-[0_35px_80px_-30px_rgba(15,23,42,0.45)]">
                <img src="/imove-hero/jewel-changi.png" alt="Jewel Changi Airport" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/55 via-transparent to-white/10" />
                <div className="absolute bottom-7 left-7 text-white">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/65">Featured discovery</p>
                  <h2 className="mt-2 text-[28px] font-black">Jewel Changi Airport</h2>
                </div>
              </div>
              <div className="preview-float-photo absolute left-0 top-16 h-44 w-36 rotate-[-7deg] overflow-hidden rounded-2xl border-4 border-white shadow-2xl">
                <img src="/imove-hero/hawker-centre.png" alt="Hawker centre" className="h-full w-full object-cover" />
              </div>
              <div className="preview-float-photo preview-float-photo-delay absolute bottom-16 right-0 h-48 w-40 rotate-[6deg] overflow-hidden rounded-2xl border-4 border-white shadow-2xl">
                <img src="/imove-hero/merlion.png" alt="Merlion" className="h-full w-full object-cover" />
              </div>
            </div>
          </div>
        </section>

        <section className="preview-route-section relative bg-white px-6 pb-24 pt-14">
          <svg className="preview-route-line pointer-events-none absolute left-1/2 top-0 h-56 w-[min(900px,90vw)] -translate-x-1/2" viewBox="0 0 900 220" fill="none" aria-hidden="true">
            <path d="M20 25 C170 205 320 10 455 125 C590 240 720 30 880 185" stroke="url(#route-gradient)" strokeWidth="3" strokeLinecap="round" />
            <defs>
              <linearGradient id="route-gradient" x1="20" y1="25" x2="880" y2="185" gradientUnits="userSpaceOnUse">
                <stop stopColor="#3B82F6" /><stop offset="0.55" stopColor="#06B6D4" /><stop offset="1" stopColor="#10B981" />
              </linearGradient>
            </defs>
          </svg>

          <div className="relative mx-auto max-w-7xl pt-28">
            <Reveal className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-600">A living travel dashboard</p>
              <h2 className="mt-4 text-[38px] font-black tracking-[-0.04em] text-slate-950 sm:text-[52px]">See the whole journey at a glance.</h2>
            </Reveal>

            <div className="mt-14 grid gap-5 lg:grid-cols-12">
              <Reveal className="lg:col-span-5">
                <article className="preview-bento-card min-h-[270px] bg-blue-600 p-7 text-white">
                  <CalendarDays className="h-6 w-6 text-blue-100" />
                  <p className="mt-12 text-[72px] font-black leading-none">02</p>
                  <h3 className="mt-4 text-[20px] font-bold">Journeys this week</h3>
                  <p className="mt-2 max-w-xs text-[13px] leading-6 text-blue-100">Your next routes are prepared and ready to adapt.</p>
                </article>
              </Reveal>
              <Reveal className="lg:col-span-4">
                <article className="preview-bento-card min-h-[270px] bg-slate-950 p-7 text-white">
                  <RadioTower className="h-6 w-6 text-emerald-300" />
                  <div className="preview-signal mt-12 flex items-end gap-2"><i /><i /><i /><i /></div>
                  <h3 className="mt-6 text-[20px] font-bold">Live network</h3>
                  <p className="mt-2 text-[13px] leading-6 text-slate-400">LTA and weather awareness are active.</p>
                </article>
              </Reveal>
              <Reveal className="lg:col-span-3">
                <article className="preview-bento-card min-h-[270px] bg-amber-50 p-7 text-slate-950">
                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                  <p className="mt-12 text-[72px] font-black leading-none">0</p>
                  <h3 className="mt-4 text-[20px] font-bold">Open alerts</h3>
                  <p className="mt-2 text-[13px] leading-6 text-slate-500">Everything looks clear.</p>
                </article>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="bg-slate-50 px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <Reveal className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-600">Your journeys</p>
                <h2 className="mt-4 text-[42px] font-black tracking-[-0.045em] text-slate-950">Where will you move next?</h2>
              </div>
              <p className="max-w-md text-[14px] leading-7 text-slate-500">A photo-first journey library designed to make every saved plan feel alive.</p>
            </Reveal>

            <div className="preview-glass-toolbar sticky top-20 z-20 mt-12 flex flex-col gap-4 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 overflow-x-auto">
                {['All trips', 'Today', 'Upcoming', 'Drafts'].map((item, index) => (
                  <button key={item} className={`shrink-0 rounded-xl px-4 py-2.5 text-[12px] font-bold ${index === 0 ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-white'}`}>{item}</button>
                ))}
              </div>
              <div className="flex h-11 items-center gap-2 rounded-xl bg-white px-4 shadow-sm">
                <Search className="h-4 w-4 text-blue-600" />
                <span className="text-[12px] font-semibold text-slate-400">Search your journeys</span>
              </div>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {JOURNEYS.map((journey, index) => (
                <Reveal key={journey.title} className={`preview-delay-${index + 1}`}>
                  <article className="preview-journey-card group overflow-hidden rounded-[24px] bg-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)]">
                    <div className="relative h-64 overflow-hidden">
                      <img src={journey.image} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-110" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
                      <span className="absolute left-5 top-5 rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 backdrop-blur">{journey.status}</span>
                      <div className="absolute bottom-5 left-5 right-5 text-white">
                        <p className="text-[11px] font-semibold text-white/70">{journey.date}</p>
                        <h3 className="mt-1 text-[24px] font-black">{journey.title}</h3>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-5">
                      <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-500"><MapPin className="h-4 w-4 text-blue-600" />{journey.meta}</span>
                      <button className="grid h-10 w-10 place-items-center rounded-full bg-blue-50 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white"><ArrowRight className="h-4 w-4" /></button>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-16">
              <div className="rounded-[28px] bg-gradient-to-r from-blue-600 to-cyan-500 p-8 text-white sm:flex sm:items-center sm:justify-between">
                <div><Route className="h-6 w-6 text-blue-100" /><h3 className="mt-5 text-[30px] font-black">A route should feel clear before it begins.</h3></div>
                <button onClick={() => navigate('/plan')} className="mt-6 inline-flex h-12 items-center gap-2 rounded-lg bg-white px-6 text-[13px] font-bold text-blue-700 sm:mt-0">Create itinerary <Navigation2 className="h-4 w-4" /></button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <CinematicFooter />
    </div>
  )
}
