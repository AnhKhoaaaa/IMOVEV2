import { useNavigate } from 'react-router-dom'
import { Train, Clock, MapPin, ArrowRight } from 'lucide-react'
import { Button } from '../components/ui/button'

const FEATURES = [
  { icon: Train, title: 'MRT & Bus thực tế', desc: 'Lộ trình chính xác từ dữ liệu LTA Singapore' },
  { icon: Clock, title: 'Thời gian & chi phí', desc: 'Tính toán cụ thể từng chặng, không ước tính' },
  { icon: MapPin, title: '50+ địa điểm nổi bật', desc: 'Bộ sưu tập POI đã kiểm duyệt cho du khách' },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      {/* Hero */}
      <section className="mx-auto max-w-2xl px-6 pt-16 pb-12 text-center sm:pt-24">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
          <MapPin className="h-3 w-3" />
          Singapore Transit Planner
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Khám phá Singapore<br />
          <span className="text-sky-500">bằng phương tiện công cộng</span>
        </h1>
        <p className="mt-4 text-base text-slate-500 sm:text-lg leading-relaxed">
          Lập kế hoạch hành trình theo ngày với lộ trình MRT, bus chính xác —
          thời gian và chi phí rõ ràng cho từng chặng.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button size="lg" onClick={() => navigate('/plan')} className="w-full sm:w-auto gap-2">
            Bắt đầu lập kế hoạch
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                <Icon className="h-5 w-5 text-sky-500" />
              </div>
              <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
