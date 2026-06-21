import { useLang } from '../contexts/LanguageContext'

export default function Privacy() {
  const { lang } = useLang()

  if (lang === 'vi') {
    return (
      <div className="pt-32 px-6 max-w-3xl mx-auto pb-24 animate-slide-up">
        <div className="mb-10">
          <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-slate-950 mb-4">
            Chính sách Bảo mật
          </h1>
          <p className="text-slate-500 text-lg">Cập nhật lần cuối: 20 Tháng 6, 2026</p>
        </div>

        <div className="card p-6 md:p-10 space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">1. Thông tin Chúng tôi Thu thập</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              Để cung cấp cho bạn kế hoạch di chuyển chính xác và điều chỉnh theo thời gian thực, chúng tôi thu thập một số thông tin nhất định khi bạn sử dụng dịch vụ. Bao gồm:
            </p>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>
                <strong className="text-slate-800">Vị trí GPS:</strong> Chúng tôi truy cập vị trí thiết bị của bạn để xác định điểm xuất phát, hiển thị vị trí của bạn trên bản đồ và kích hoạt các cảnh báo giao thông dựa trên khoảng cách.
              </li>
              <li>
                <strong className="text-slate-800">Tuyến đường & Sở thích:</strong> Chúng tôi lưu trữ các lịch trình bạn đã chọn, phương tiện ưu tiên (xe buýt, MRT, đi bộ) và các cài đặt tùy chỉnh (ví dụ: "ít đi bộ nhất" hoặc "giá vé rẻ nhất").
              </li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          <section>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">2. Cách Chúng tôi Sử dụng Dữ liệu</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              Dữ liệu thu thập được sử dụng hoàn toàn để nâng cao trải nghiệm du lịch của bạn tại Singapore. Cụ thể, chúng tôi sử dụng để:
            </p>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>Tạo các lịch trình di chuyển cá nhân hóa cho nhiều ngày.</li>
              <li>Theo dõi dữ liệu LTA và dự báo OpenWeather theo thời gian thực để đề xuất các thay đổi lộ trình phù hợp khi có gián đoạn hoặc mưa lớn.</li>
              <li>Cho phép các agent AI của chúng tôi học hỏi từ phản hồi của bạn để tối ưu hóa các đề xuất trong tương lai.</li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          <section>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">3. Bảo mật Dữ liệu</h2>
            <p className="text-slate-600 leading-relaxed">
              Chúng tôi ưu tiên bảo mật thông tin của bạn. Tất cả nhật ký di chuyển, sở thích và thông tin đăng nhập tài khoản đều được mã hóa và lưu trữ an toàn bằng các dịch vụ backend của chúng tôi (Supabase). Chúng tôi không bán dữ liệu GPS hoặc lịch sử di chuyển của bạn cho các nhà quảng cáo bên thứ ba. Quyền truy cập vào dữ liệu của bạn bị giới hạn nghiêm ngặt trong các yêu cầu chức năng của ứng dụng IMOVE.
            </p>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-32 px-6 max-w-3xl mx-auto pb-24 animate-slide-up">
      <div className="mb-10">
        <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-slate-950 mb-4">
          Privacy Policy
        </h1>
        <p className="text-slate-500 text-lg">Last updated: June 20, 2026</p>
      </div>

      <div className="card p-6 md:p-10 space-y-10">
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">1. Information We Collect</h2>
          <p className="text-slate-600 leading-relaxed mb-4">
            To provide you with accurate transit planning and real-time adaptations, we collect certain information when you use our services. This includes:
          </p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>
              <strong className="text-slate-800">GPS Location:</strong> We access your device's location to determine your starting point, show your position on the map, and trigger proximity-based transit alerts.
            </li>
            <li>
              <strong className="text-slate-800">Transit Routes & Preferences:</strong> We store your chosen itineraries, preferred transport modes (bus, MRT, walking), and custom settings (e.g., "least walking" or "cheapest fare").
            </li>
          </ul>
        </section>

        <hr className="border-slate-100" />

        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">2. How We Use Your Data</h2>
          <p className="text-slate-600 leading-relaxed mb-4">
            The data we collect is used strictly to enhance your travel experience in Singapore. Specifically, we use it to:
          </p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>Generate personalized, multi-day transit itineraries.</li>
            <li>Monitor real-time LTA data and OpenWeather forecasts to propose adaptive route swaps when disruptions or heavy rain occur.</li>
            <li>Allow our AI planning agents to learn from your feedback and optimize future suggestions.</li>
          </ul>
        </section>

        <hr className="border-slate-100" />

        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">3. Data Security</h2>
          <p className="text-slate-600 leading-relaxed">
            We prioritize the security of your information. All transit logs, preferences, and account credentials are encrypted and stored securely using our backend services (Supabase). We do not sell your GPS data or transit histories to third-party advertisers. Access to your data is strictly limited to the functional requirements of the IMOVE application.
          </p>
        </section>
      </div>
    </div>
  )
}
