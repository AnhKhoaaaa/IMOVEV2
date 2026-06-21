import { useLang } from '../contexts/LanguageContext'

export default function Privacy() {
  const { lang } = useLang()

  const policies = {
    vi: {
      title: "Chính sách bảo mật dữ liệu cá nhân",
      subtitle: "Đơn giản, minh bạch và an toàn.",
      sections: [
        {
          title: "1. Giới thiệu",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Ứng dụng IMOVE ("chúng tôi") cam kết bảo vệ thông tin cá nhân và quyền riêng tư của bạn. Chính sách bảo vệ dữ liệu này nhằm mục đích thông báo cho bạn các quyền đối với dữ liệu của mình, lý do chúng tôi thu thập dữ liệu, cách chúng tôi sử dụng và bảo vệ chúng trong quá trình bạn trải nghiệm ứng dụng.
            </p>
          )
        },
        {
          title: "2. Dữ liệu chúng tôi thu thập và Mục đích sử dụng",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">Việc thực hiện các chức năng hỗ trợ du lịch đòi hỏi chúng tôi phải xử lý một số thông tin nhất định:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li><strong>Dữ liệu Vị trí (GPS):</strong> Chúng tôi chỉ thu thập vị trí của bạn theo thời gian thực khi bạn chủ động cấp quyền và mở ứng dụng. Mục đích duy nhất là để tìm trạm MRT/Bus gần nhất và đề xuất lộ trình di chuyển chính xác tại Singapore.</li>
                <li><strong>Dữ liệu Lưu trữ cục bộ (Local Storage/Cache):</strong> Để đảm bảo ứng dụng vẫn hoạt động khi bạn rớt mạng (ví dụ: khi đi dưới hầm tàu điện ngầm), chúng tôi sẽ lưu trữ tạm thời dữ liệu bản đồ và lịch trình trực tiếp trên thiết bị của bạn.</li>
              </ul>
              <p className="text-slate-600 leading-relaxed">Chúng tôi cam kết xử lý dữ liệu một cách hợp pháp, công bằng và minh bạch, giới hạn ở mức độ cần thiết cho các tiện ích của ứng dụng.</p>
            </div>
          )
        },
        {
          title: "3. Dữ liệu chúng tôi KHÔNG thu thập",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Chúng tôi tuyệt đối KHÔNG thu thập những dữ liệu nhạy cảm bao gồm: nguồn gốc chủng tộc, quan điểm chính trị, tín ngưỡng, dữ liệu sinh trắc học, dữ liệu sức khỏe, hoặc thông tin tài chính cá nhân của bạn. Đồng thời, chúng tôi không theo dõi ngầm hoặc lưu trữ lịch sử di chuyển của bạn sau khi bạn đã đóng ứng dụng.
            </p>
          )
        },
        {
          title: "4. Không yêu cầu cung cấp dữ liệu bắt buộc",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Việc cung cấp vị trí hoặc dữ liệu cá nhân cho IMOVE là hoàn toàn tự nguyện. Bạn có thể từ chối cấp quyền truy cập vị trí bất cứ lúc nào thông qua cài đặt thiết bị. Tuy nhiên, xin lưu ý rằng nếu không có dữ liệu vị trí, một số tính năng cốt lõi như chỉ đường trực tiếp sẽ không thể hoạt động đầy đủ.
            </p>
          )
        },
        {
          title: "5. Chia sẻ dữ liệu cá nhân",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Dữ liệu của bạn thuộc về bạn. Chúng tôi cam kết KHÔNG bán, cho thuê hoặc chia sẻ dữ liệu vị trí/cá nhân của bạn cho bất kỳ bên thứ ba nào vì mục đích quảng cáo thương mại. Dữ liệu chỉ được xử lý nội bộ hoặc thông qua các nền tảng máy chủ bảo mật mà chúng tôi hợp tác để vận hành ứng dụng.
            </p>
          )
        },
        {
          title: "6. Quyền của bạn",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">Bạn hoàn toàn nắm quyền kiểm soát dữ liệu của mình. Bạn có quyền:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li>Rút lại sự đồng ý truy cập dữ liệu vị trí bất cứ lúc nào.</li>
                <li>Yêu cầu xóa toàn bộ dữ liệu lịch trình đã lưu trên ứng dụng (thông qua tính năng Xóa Cache trong phần Cài đặt).</li>
              </ul>
            </div>
          )
        },
        {
          title: "7. Cập nhật đối với Chính sách này",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Chúng tôi bảo lưu quyền cập nhật Chính sách này để phù hợp với các thay đổi về tính năng ứng dụng hoặc tuân thủ các quy định pháp luật hiện hành. Những thay đổi quan trọng sẽ được thông báo rõ ràng trên ứng dụng.
            </p>
          )
        }
      ]
    },
    en: {
      title: "Personal Data Privacy Policy",
      subtitle: "Simple, transparent, and safe.",
      sections: [
        {
          title: "1. Introduction",
          content: (
            <p className="text-slate-600 leading-relaxed">
              The IMOVE app ("we") is committed to protecting your personal information and privacy. This data protection policy aims to inform you of your rights regarding your data, why we collect data, and how we use and protect it during your app experience.
            </p>
          )
        },
        {
          title: "2. Data We Collect and Purpose of Use",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">Performing travel support functions requires us to process certain information:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li><strong>Location Data (GPS):</strong> We only collect your real-time location when you actively grant permission and open the app. The sole purpose is to find the nearest MRT/Bus station and recommend accurate travel routes in Singapore.</li>
                <li><strong>Local Storage/Cache Data:</strong> To ensure the app remains functional when you lose internet connection (e.g., when traveling in subway tunnels), we temporarily store map and schedule data directly on your device.</li>
              </ul>
              <p className="text-slate-600 leading-relaxed">We are committed to processing data lawfully, fairly, and transparently, limited to what is necessary for the app's utilities.</p>
            </div>
          )
        },
        {
          title: "3. Data We Do NOT Collect",
          content: (
            <p className="text-slate-600 leading-relaxed">
              We absolutely do NOT collect sensitive data including: racial origin, political opinions, religious beliefs, biometric data, health data, or your personal financial information. At the same time, we do not secretly track or store your travel history after you have closed the app.
            </p>
          )
        },
        {
          title: "4. Mandatory Data Provision Not Required",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Providing location or personal data to IMOVE is completely voluntary. You can refuse to grant location access at any time through your device settings. However, please note that without location data, some core features like live navigation will not function fully.
            </p>
          )
        },
        {
          title: "5. Sharing Personal Data",
          content: (
            <p className="text-slate-600 leading-relaxed">
              Your data belongs to you. We promise NOT to sell, rent, or share your location/personal data to any third party for commercial advertising purposes. Data is only processed internally or through secure server platforms we partner with to operate the app.
            </p>
          )
        },
        {
          title: "6. Your Rights",
          content: (
            <div className="space-y-4">
              <p className="text-slate-600 leading-relaxed">You are completely in control of your data. You have the right to:</p>
              <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
                <li>Withdraw consent for location data access at any time.</li>
                <li>Request deletion of all saved schedule data on the app (via the Clear Cache feature in Settings).</li>
              </ul>
            </div>
          )
        },
        {
          title: "7. Updates to this Policy",
          content: (
            <p className="text-slate-600 leading-relaxed">
              We reserve the right to update this Policy to reflect changes in app features or comply with applicable legal regulations. Important changes will be clearly notified on the app.
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
        <p className="text-slate-500 text-lg">
          {currentContent.subtitle}
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

