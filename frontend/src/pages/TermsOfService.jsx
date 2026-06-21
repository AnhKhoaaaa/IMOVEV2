import { useLang } from '../contexts/LanguageContext'

export default function TermsOfService() {
  const { lang } = useLang()

  const policies = {
    vi: {
      title: "Điều khoản Dịch vụ",
      subtitle: "Cập nhật lần cuối: Tháng 6 năm 2026",
      intro: "Chào mừng bạn đến với IMOVE! Khi truy cập và sử dụng ứng dụng IMOVE (\"Ứng dụng\") để xem lịch trình, bản đồ và hướng dẫn giao thông tại Singapore, bạn đồng ý tuân thủ các điều khoản và điều kiện dưới đây. Vui lòng đọc kỹ trước khi sử dụng.",
      sections: [
        {
          title: "1. Chấp nhận Điều khoản",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Bằng việc sử dụng Ứng dụng, bạn đồng ý vô điều kiện với các Điều khoản Dịch vụ này. IMOVE có quyền cập nhật và sửa đổi các điều khoản này vào bất kỳ lúc nào mà không cần báo trước. Việc bạn tiếp tục sử dụng Ứng dụng sau khi có thay đổi đồng nghĩa với việc bạn chấp nhận các điều khoản mới.
            </p>
          )
        },
        {
          title: "2. Mục đích Sử dụng & Bản quyền",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">Tất cả nội dung trên Ứng dụng (bao gồm thiết kế, giao diện, logo, và hướng dẫn) thuộc bản quyền của IMOVE.</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li>Bạn chỉ được phép sử dụng thông tin từ Ứng dụng cho mục đích cá nhân, phi thương mại (như tra cứu đường đi, lên lịch trình du lịch).</li>
                <li>Nghiêm cấm mọi hành vi sao chép, trích xuất dữ liệu tự động (crawl/scrape), hoặc sử dụng thông tin của IMOVE để phát triển một ứng dụng/dịch vụ cạnh tranh.</li>
              </ul>
            </div>
          )
        },
        {
          title: "3. Từ chối Bảo đảm và Miễn trừ Trách nhiệm (Quan trọng)",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">Ứng dụng IMOVE cung cấp các công cụ hỗ trợ di chuyển dựa trên dữ liệu giao thông công cộng. Tuy nhiên:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li><strong>Chỉ mang tính tham khảo:</strong> Mọi thông tin về tuyến đường MRT, Bus, lịch trình và thời gian dự kiến chỉ mang tính chất tham khảo. Chúng tôi cung cấp dữ liệu "nguyên trạng" (as is) và không đảm bảo độ chính xác tuyệt đối.</li>
                <li><strong>Trách nhiệm của đối tác thứ ba:</strong> IMOVE không chịu trách nhiệm pháp lý nếu bạn bị lỡ chuyến, đến trễ hoặc gặp sự cố do thay đổi lịch trình đột xuất từ các nhà điều hành vận tải (như SMRT, SBS Transit), do kẹt xe, hoặc thời tiết xấu.</li>
                <li><strong>Sự cố kỹ thuật:</strong> IMOVE không đảm bảo Ứng dụng sẽ hoạt động liên tục không gián đoạn hoặc hoàn toàn không có lỗi hệ thống.</li>
              </ul>
            </div>
          )
        },
        {
          title: "4. Quy tắc Ứng xử của Người dùng",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">Khi sử dụng IMOVE tại Singapore, bạn đồng ý:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li>Tuân thủ mọi luật lệ giao thông và quy định tại các ga MRT/Trạm Bus của nước sở tại (ví dụ: không ăn uống trên tàu điện ngầm).</li>
                <li>Không can thiệp, phá hoại hoặc sử dụng các phần mềm độc hại gây ảnh hưởng đến hệ thống máy chủ của IMOVE.</li>
              </ul>
            </div>
          )
        },
        {
          title: "5. Liên kết của Bên Thứ Ba",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Ứng dụng có thể chứa các liên kết dẫn đến trang web của bên thứ ba (ví dụ: trang mua vé tham quan, đặt Grab/Gojek). IMOVE không kiểm soát và không chịu trách nhiệm về nội dung, chính sách bảo mật hay bất kỳ rủi ro nào phát sinh khi bạn giao dịch trên các trang web đó.
            </p>
          )
        },
        {
          title: "6. Chấm dứt Quyền Truy cập",
          content: (
            <p className="text-slate-600 leading-relaxed">
              IMOVE có quyền vô hiệu hóa tài khoản hoặc chặn quyền truy cập của bạn vào Ứng dụng bất cứ lúc nào nếu chúng tôi phát hiện bạn vi phạm các Điều khoản này, mà không cần đưa ra lý do giải thích chi tiết.
            </p>
          )
        },
        {
          title: "7. Luật Áp dụng",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Các Điều khoản này được điều chỉnh và giải thích theo luật pháp của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam (nơi phát triển dự án) và các quy định quốc tế có liên quan.
            </p>
          )
        }
      ]
    },
    en: {
      title: "Terms of Service",
      subtitle: "Last updated: June 2026",
      intro: "Welcome to IMOVE! By accessing and using the IMOVE application (\"App\") to view schedules, maps, and transit directions in Singapore, you agree to comply with the terms and conditions below. Please read carefully before using.",
      sections: [
        {
          title: "1. Acceptance of Terms",
          content: (
            <p className="text-slate-600 leading-relaxed">
              By using the App, you unconditionally agree to these Terms of Service. IMOVE reserves the right to update and modify these terms at any time without prior notice. Your continued use of the App after changes have been made constitutes your acceptance of the new terms.
            </p>
          )
        },
        {
          title: "2. Purpose of Use & Copyright",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">All content on the App (including design, interface, logo, and instructions) is copyrighted by IMOVE.</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li>You are only allowed to use information from the App for personal, non-commercial purposes (such as finding routes, planning travel itineraries).</li>
                <li>Any act of copying, automated data extraction (crawl/scrape), or using IMOVE's information to develop a competing app/service is strictly prohibited.</li>
              </ul>
            </div>
          )
        },
        {
          title: "3. Disclaimer of Warranties and Liability (Important)",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">The IMOVE app provides travel support tools based on public transport data. However:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li><strong>Reference only:</strong> All information regarding MRT/Bus routes, schedules, and estimated times is for reference only. We provide data "as is" and do not guarantee absolute accuracy.</li>
                <li><strong>Third-party liability:</strong> IMOVE is not legally responsible if you miss your trip, arrive late, or encounter issues due to sudden schedule changes from transport operators (like SMRT, SBS Transit), traffic jams, or bad weather.</li>
                <li><strong>Technical issues:</strong> IMOVE does not guarantee the App will operate continuously without interruption or be completely free of system errors.</li>
              </ul>
            </div>
          )
        },
        {
          title: "4. User Code of Conduct",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">When using IMOVE in Singapore, you agree to:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li>Comply with all traffic laws and local regulations at MRT stations/Bus stops (e.g., no eating or drinking on the subway).</li>
                <li>Not interfere, sabotage, or use malicious software that affects IMOVE's server systems.</li>
              </ul>
            </div>
          )
        },
        {
          title: "5. Third-Party Links",
          content: (
            <p className="text-slate-600 leading-relaxed">
              The App may contain links to third-party websites (e.g., ticket purchasing sites, Grab/Gojek bookings). IMOVE has no control over and is not responsible for the content, privacy policies, or any risks arising when you transact on those websites.
            </p>
          )
        },
        {
          title: "6. Termination of Access",
          content: (
            <p className="text-slate-600 leading-relaxed">
              IMOVE reserves the right to disable your account or block your access to the App at any time if we detect you violating these Terms, without needing to provide a detailed explanation.
            </p>
          )
        },
        {
          title: "7. Governing Law",
          content: (
            <p className="text-slate-600 leading-relaxed">
              These Terms are governed and interpreted in accordance with the laws of the Socialist Republic of Vietnam (where the project is developed) and relevant international regulations.
            </p>
          )
        }
      ]
    }
  }

  const currentContent = policies[lang] || policies['en']

  return (
    <div className="pt-24 px-6 max-w-3xl mx-auto pb-24 animate-slide-up">
      <div className="mb-12">
        <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight text-slate-900 mb-4">
          {currentContent.title}
        </h1>
        <p className="text-slate-500 text-sm font-medium mb-6">
          {currentContent.subtitle}
        </p>
        <p className="text-slate-600 text-lg leading-relaxed">
          {currentContent.intro}
        </p>
      </div>

      <div className="space-y-10">
        {currentContent.sections.map((section, index) => (
          <div key={index} className="group">
            <h2 className="text-xl font-display font-bold text-slate-900 mb-4 tracking-tight">
              {section.title}
            </h2>
            <div className="text-base">
              {section.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
