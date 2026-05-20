import { Lightbulb, ChevronDown } from 'lucide-react'

const ALWAYS_TIPS = [
  'Mua thẻ EZ-Link tại Changi Airport hoặc 7-Eleven để đi MRT/bus — tiện hơn trả tiền mặt.',
  'Hầu hết hawker centre và quán ăn vỉa hè chỉ nhận tiền mặt SGD — mang theo tiền lẻ.',
]

const CONDITIONAL_TIPS = [
  {
    key: 'outdoor',
    condition: (places) => places.some((p) => p.is_outdoor),
    tip: 'Mang kem chống nắng SPF 50+ — Singapore có UV Index cao quanh năm.',
  },
  {
    key: 'religious',
    condition: (places) =>
      places.some(
        (p) =>
          ['museum', 'heritage'].includes(p.category) ||
          /mosque|temple|church/i.test(p.name),
      ),
    tip: 'Ăn mặc kín đáo và cởi giày trước khi vào đền chùa hoặc nhà thờ Hồi giáo.',
  },
  {
    key: 'night',
    condition: (places) => places.some((p) => p.best_time_start >= '19:00'),
    tip: 'Book vé trước trực tuyến để tránh xếp hàng tại các điểm tham quan về đêm.',
  },
  {
    key: 'nature',
    condition: (places) => places.some((p) => p.category === 'nature'),
    tip: 'Kiểm tra dự báo thời tiết — mưa chiều thường xuyên từ tháng 11 đến tháng 1.',
  },
]

function computeTips(places) {
  const conditional = CONDITIONAL_TIPS.filter(({ condition }) => condition(places)).map(
    ({ tip }) => tip,
  )
  return [...ALWAYS_TIPS, ...conditional]
}

export default function TravelTips({ places = [] }) {
  if (places.length === 0) return null

  const tips = computeTips(places)

  return (
    <details className="group mt-3 rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-sm font-semibold text-amber-800">
            Lưu ý hành trình ({tips.length})
          </span>
        </div>
        <ChevronDown className="h-4 w-4 text-amber-500 transition-transform duration-200 group-open:rotate-180" />
      </summary>

      <ul className="divide-y divide-amber-100 border-t border-amber-200">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2.5 px-4 py-2.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
            <p className="text-xs text-amber-900 leading-relaxed">{tip}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
