import { Mail } from 'lucide-react'
import { useLang } from '../contexts/LanguageContext'

export default function Support() {
  const { lang } = useLang()

  if (lang === 'vi') {
    return (
      <div className="pt-32 px-6 max-w-3xl mx-auto pb-24 animate-slide-up">
        <div className="mb-10">
          <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-slate-950 mb-4">
            Hỗ trợ & Câu hỏi thường gặp
          </h1>
          <p className="text-slate-500 text-lg">
            Cần giúp đỡ khi di chuyển tại Singapore? Chúng tôi luôn sẵn sàng.
          </p>
        </div>

        <div className="card p-6 md:p-10 space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Câu hỏi thường gặp</h2>
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">Làm thế nào để tìm tuyến MRT hoặc Bus tốt nhất?</h3>
                <p className="text-slate-600 leading-relaxed">
                  Chỉ cần nhập điểm xuất phát và điểm đến của bạn vào Planner. Các agent thông minh của IMOVE sẽ tính toán sự kết hợp hiệu quả nhất giữa MRT và xe buýt, cân bằng giữa thời gian di chuyển, khoảng cách đi bộ và chi phí dựa trên dữ liệu thời gian thực.
                </p>
              </div>

              <hr className="border-slate-100" />

              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">Chuyện gì xảy ra nếu tàu hoặc xe buýt của tôi bị trễ?</h3>
                <p className="text-slate-600 leading-relaxed">
                  IMOVE giám sát dữ liệu trực tiếp từ LTA DataMall. Nếu có sự cố gián đoạn trên tuyến đường bạn đã chọn, Adaptation Agent của chúng tôi sẽ tự động cảnh báo và đề xuất các phương án thay thế để đưa bạn đến nơi an toàn.
                </p>
              </div>

              <hr className="border-slate-100" />

              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">Tôi có thể tùy chỉnh phương tiện ưu tiên không?</h3>
                <p className="text-slate-600 leading-relaxed">
                  Có! Trong phần Sở thích đi lại, bạn có thể thiết lập các ưu tiên định tuyến, chẳng hạn như "Nhanh nhất", "Rẻ nhất" hoặc "Ít đi bộ nhất". Planner sẽ ưu tiên các tuyến đường phù hợp với hồ sơ du lịch cụ thể của bạn.
                </p>
              </div>
            </div>
          </section>

          <section className="text-center bg-slate-50 rounded-xl p-8 border border-slate-100">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Vẫn cần hỗ trợ?</h2>
            <p className="text-slate-600 mb-6">
              Nếu bạn gặp sự cố chưa được đề cập ở trên, đội ngũ hỗ trợ của chúng tôi luôn sẵn sàng giúp đỡ.
            </p>
            <a
              href="mailto:support@imove.example.com"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-3.5 rounded-xl btn-lift"
            >
              <Mail className="w-5 h-5" />
              Liên hệ Hỗ trợ
            </a>
            <p className="text-slate-400 text-sm mt-4">support@imove.example.com</p>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-32 px-6 max-w-3xl mx-auto pb-24 animate-slide-up">
      <div className="mb-10">
        <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-slate-950 mb-4">
          Support & FAQ
        </h1>
        <p className="text-slate-500 text-lg">
          Need help navigating Singapore? We're here for you.
        </p>
      </div>

      <div className="card p-6 md:p-10 space-y-10">
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">How do I find the best MRT or Bus route?</h3>
              <p className="text-slate-600 leading-relaxed">
                Simply enter your starting point and destination in the Planner. IMOVE's intelligent agents will calculate the most efficient combinations of MRT and buses, balancing travel time, walking distance, and cost based on real-time data.
              </p>
            </div>

            <hr className="border-slate-100" />

            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">What happens if my train or bus is delayed?</h3>
              <p className="text-slate-600 leading-relaxed">
                IMOVE monitors live data from the LTA DataMall. If a disruption occurs on your planned route, our Adaptation Agent will automatically alert you and suggest alternative options to get you to your destination safely.
              </p>
            </div>

            <hr className="border-slate-100" />

            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Can I customize my preferred transport mode?</h3>
              <p className="text-slate-600 leading-relaxed">
                Yes! In your Travel Preferences, you can set your routing priorities, such as "Fastest", "Cheapest", or "Least Walking". The planner will prioritize routes that match your specific travel profile.
              </p>
            </div>
          </div>
        </section>

        <section className="text-center bg-slate-50 rounded-xl p-8 border border-slate-100">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">
            Still need assistance?
          </h2>
          <p className="text-slate-600 mb-6">
            If you have an issue that isn't covered above, our support team is ready to help you out.
          </p>
          <a
            href="mailto:support@imove.example.com"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-3.5 rounded-xl btn-lift"
          >
            <Mail className="w-5 h-5" />
            Contact Support
          </a>
          <p className="text-slate-400 text-sm mt-4">
            support@imove.example.com
          </p>
        </section>
      </div>
    </div>
  )
}
