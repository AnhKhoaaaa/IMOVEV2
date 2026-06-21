import { useLang } from '../contexts/LanguageContext'

export default function Terms() {
  const { lang } = useLang()

  if (lang === 'vi') {
    return (
      <div className="pt-32 px-6 max-w-3xl mx-auto pb-24 animate-slide-up">
        <div className="mb-10">
          <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-slate-950 mb-4">
            Điều khoản Dịch vụ
          </h1>
          <p className="text-slate-500 text-lg">Cập nhật lần cuối: 20 Tháng 6, 2026</p>
        </div>

        <div className="card p-6 md:p-10 space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">1. Chấp nhận Điều khoản</h2>
            <p className="text-slate-600 leading-relaxed">
              Bằng cách truy cập và sử dụng ứng dụng IMOVE, bạn chấp nhận và đồng ý bị ràng buộc bởi các điều khoản và quy định của thỏa thuận này. Nếu bạn không đồng ý tuân thủ các điều khoản này, vui lòng không sử dụng dịch vụ của chúng tôi. Chúng tôi có quyền sửa đổi các điều khoản này bất cứ lúc nào và việc bạn tiếp tục sử dụng dịch vụ đồng nghĩa với việc bạn chấp nhận mọi điều khoản đã được cập nhật.
            </p>
          </section>

          <hr className="border-slate-100" />

          <section>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">2. Quy tắc Ứng xử</h2>
            <p className="text-slate-600 leading-relaxed">
              Bạn đồng ý chỉ sử dụng thông tin giao thông và các công cụ định tuyến do IMOVE cung cấp cho các mục đích hợp pháp. Bạn không được sử dụng dịch vụ của chúng tôi để làm gián đoạn hoạt động giao thông công cộng, lạm dụng giới hạn API hoặc tham gia vào bất kỳ hoạt động gian lận nào. Mọi hành vi tự động trích xuất dữ liệu (scraping) giao thông công cộng hoặc các tuyến đường từ nền tảng của chúng tôi mà không có sự cho phép rõ ràng đều bị nghiêm cấm.
            </p>
          </section>

          <hr className="border-slate-100" />

          <section>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">3. Miễn trừ Trách nhiệm</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              IMOVE dựa vào các API của bên thứ ba (bao gồm OneMap API và LTA DataMall) để cung cấp kế hoạch di chuyển và cập nhật theo thời gian thực. Do đó, chúng tôi cung cấp dịch vụ trên cơ sở "nguyên trạng" và "tùy theo khả năng sẵn có". Xin lưu ý rằng:
            </p>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>Các tuyến đường, thời gian đến và giá vé chỉ là ước tính và mang tính chất tham khảo.</li>
              <li>Điều kiện thực tế, chẳng hạn như thay đổi thời tiết đột ngột hoặc gián đoạn chuyến tàu không báo trước, có thể khác với thông tin được hiển thị.</li>
              <li>Chúng tôi không chịu trách nhiệm cho bất kỳ sự chậm trễ, lỡ chuyến hoặc tổn thất tài chính nào phát sinh khi sử dụng lịch trình của chúng tôi. Hãy luôn dành thêm thời gian cho các chuyến đi của bạn.</li>
            </ul>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-32 px-6 max-w-3xl mx-auto pb-24 animate-slide-up">
      <div className="mb-10">
        <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-slate-950 mb-4">
          Terms of Service
        </h1>
        <p className="text-slate-500 text-lg">Last updated: June 20, 2026</p>
      </div>

      <div className="card p-6 md:p-10 space-y-10">
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">1. Acceptance of Terms</h2>
          <p className="text-slate-600 leading-relaxed">
            By accessing and using the IMOVE application, you accept and agree to be bound by the terms and provisions of this agreement. If you do not agree to abide by these terms, please do not use our service. We reserve the right to modify these terms at any time, and your continued use of the service signifies your acceptance of any updated terms.
          </p>
        </section>

        <hr className="border-slate-100" />

        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">2. User Conduct</h2>
          <p className="text-slate-600 leading-relaxed">
            You agree to use the transit information and routing tools provided by IMOVE exclusively for lawful purposes. You must not use our service to disrupt public transport operations, abuse API rate limits, or engage in any fraudulent activity. Any automated scraping of public transport data or transit routes from our platform without explicit permission is strictly prohibited.
          </p>
        </section>

        <hr className="border-slate-100" />

        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">3. Disclaimers</h2>
          <p className="text-slate-600 leading-relaxed mb-4">
            IMOVE relies on third-party APIs (including OneMap API and LTA DataMall) to provide transit plans and real-time updates. Therefore, we provide our services on an "as-is" and "as-available" basis. Please be aware that:
          </p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>Transit routes, arrival times, and fares are estimates intended for reference purposes only.</li>
            <li>Real-world conditions, such as sudden weather changes or unannounced train disruptions, may differ from the information displayed.</li>
            <li>We are not liable for any delays, missed connections, or financial losses incurred while using our itineraries. Always allow extra time for your journeys.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
