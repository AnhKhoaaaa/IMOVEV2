import { useState } from 'react'
import { ChevronDown, Mail, Phone, LifeBuoy } from 'lucide-react'
import { useLang } from '../contexts/LanguageContext'

function AccordionItem({ question, answer, isOpen, onClick }) {
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white mb-4 transition-all duration-200 hover:border-slate-300">
      <button 
        className="w-full text-left px-6 py-5 flex items-center justify-between bg-white focus:outline-none cursor-pointer"
        onClick={onClick}
      >
        <span className="font-semibold text-slate-900 text-lg pr-4">{question}</span>
        <ChevronDown 
          className={`shrink-0 w-6 h-6 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>
      <div 
        className={`px-6 overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-96 pb-5 opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <p className="text-slate-600 leading-relaxed pt-3 border-t border-slate-100">{answer}</p>
      </div>
    </div>
  )
}

export default function Support() {
  const { lang } = useLang()
  const [openIndex, setOpenIndex] = useState(0)

  const content = {
    vi: {
      title: "Trung tâm Hỗ trợ IMOVE",
      subtitle: "Cần giúp đỡ khi di chuyển tại Singapore? Chúng tôi luôn sẵn sàng.",
      faqTitle: "1. Xem câu hỏi phổ biến",
      contactTitle: "2. Vẫn cần trợ giúp?",
      contactDesc: "Nếu bạn có bất kỳ câu hỏi nào khác hoặc cần hỗ trợ kỹ thuật về ứng dụng, đừng ngần ngại liên hệ với đội ngũ phát triển IMOVE qua:",
      faqs: [
        { q: "Làm sao để tìm trạm MRT/Bus gần tôi nhất?", a: "Rất đơn giản! Chỉ cần cấp quyền truy cập vị trí (GPS) cho IMOVE, hệ thống sẽ tự động quét và hiển thị các trạm MRT hoặc trạm xe bus gần nhất trên bản đồ cùng thời gian tàu chạy dự kiến." },
        { q: "Ứng dụng có hoạt động khi mất mạng (xuống hầm MRT) không?", a: "Có nhé! IMOVE được trang bị tính năng lưu trữ ngoại tuyến (Offline). Bạn vẫn có thể xem lại lịch trình đã lưu và bản đồ tuyến đường ngay cả khi rớt mạng dưới hầm tàu điện ngầm." },
        { q: "Tôi có cần mua vé tàu trực tiếp trên IMOVE không?", a: "Không. IMOVE là ứng dụng hỗ trợ điều hướng và lên lịch trình. Để đi tàu MRT hoặc xe Bus tại Singapore, bạn chỉ cần dùng thẻ EZ-Link, thẻ Singapore Tourist Pass, hoặc chạm thẻ tín dụng (Visa/Mastercard) trực tiếp tại cổng soát vé." },
        { q: "Nếu trời đột ngột đổ mưa thì lịch trình của tôi tính sao?", a: "Đừng lo! IMOVE có tính năng cảnh báo thời tiết theo thời gian thực. Nếu phát hiện trời mưa, trợ lý AI sẽ tự động đề xuất các địa điểm tham quan trong nhà (như bảo tàng, trung tâm thương mại) gần bạn nhất để điều chỉnh lộ trình cho phù hợp." },
        { q: "Các số điện thoại khẩn cấp tại Singapore là gì?", a: "Hãy lưu lại ngay các số này: Cảnh sát (999), Cứu thương & Cứu hỏa (995). Nếu cần hỗ trợ về lãnh sự, hãy gọi Đại sứ quán Việt Nam tại Singapore: +65 6462 5938." }
      ],
      hotlineTime: "(Hoạt động từ 8:00 - 20:00 mỗi ngày)"
    },
    en: {
      title: "IMOVE Support Center",
      subtitle: "Need help navigating Singapore? We are always ready.",
      faqTitle: "1. Frequently Asked Questions",
      contactTitle: "2. Still need help?",
      contactDesc: "If you have any other questions or need technical support regarding the app, don't hesitate to contact the IMOVE development team via:",
      faqs: [
        { q: "How do I find the nearest MRT/Bus station?", a: "Very simple! Just grant location access (GPS) to IMOVE, and the system will automatically scan and display the nearest MRT or bus stations on the map along with estimated arrival times." },
        { q: "Does the app work offline (in MRT tunnels)?", a: "Yes! IMOVE is equipped with offline storage. You can still review your saved itineraries and route maps even when losing internet connection underground." },
        { q: "Do I need to buy train tickets directly on IMOVE?", a: "No. IMOVE is a navigation and itinerary planning app. To take the MRT or Bus in Singapore, you just need to use an EZ-Link card, Singapore Tourist Pass, or tap your credit card (Visa/Mastercard) directly at the fare gates." },
        { q: "What happens to my itinerary if it suddenly rains?", a: "Don't worry! IMOVE has a real-time weather alert feature. If rain is detected, the AI assistant will automatically suggest the nearest indoor attractions (like museums, shopping malls) to adjust your route accordingly." },
        { q: "What are the emergency numbers in Singapore?", a: "Save these numbers immediately: Police (999), Ambulance & Fire (995). If you need consular assistance, call the Vietnam Embassy in Singapore: +65 6462 5938." }
      ],
      hotlineTime: "(Operating from 8:00 - 20:00 everyday)"
    }
  }

  const current = content[lang] || content['en']

  return (
    <div className="pt-24 px-6 max-w-3xl mx-auto pb-32 animate-slide-up">
      <div className="mb-14 text-center">
        <div className="inline-flex items-center justify-center p-3 bg-blue-100 text-blue-600 rounded-2xl mb-6 shadow-sm">
          <LifeBuoy className="w-8 h-8" />
        </div>
        <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-slate-900 mb-4">
          {current.title}
        </h1>
        <p className="text-slate-500 text-lg">
          {current.subtitle}
        </p>
      </div>

      <div className="mb-16">
        <h2 className="text-2xl font-display font-bold text-slate-900 mb-6">{current.faqTitle}</h2>
        <div className="space-y-4">
          {current.faqs.map((faq, index) => (
            <AccordionItem 
              key={index} 
              question={faq.q} 
              answer={faq.a} 
              isOpen={openIndex === index}
              onClick={() => setOpenIndex(openIndex === index ? -1 : index)}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-display font-bold text-slate-900 mb-6">{current.contactTitle}</h2>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100/50 rounded-3xl p-8 md:p-10 shadow-xl shadow-blue-900/5">
          <p className="text-slate-600 text-lg mb-8 leading-relaxed">
            {current.contactDesc}
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100/80 flex items-start gap-4 transition-transform hover:-translate-y-1 hover:shadow-md duration-300">
              <div className="bg-blue-100 text-blue-600 p-3 rounded-xl shrink-0">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium mb-1">Email</p>
                <a href="mailto:hoangkyanh012006@gmail.com" className="text-slate-900 font-semibold hover:text-blue-600 transition-colors break-all">
                  hoangkyanh012006@gmail.com
                </a>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100/80 flex items-start gap-4 transition-transform hover:-translate-y-1 hover:shadow-md duration-300">
              <div className="bg-indigo-100 text-indigo-600 p-3 rounded-xl shrink-0">
                <Phone className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium mb-1">Hotline</p>
                <a href="tel:0942063227" className="text-slate-900 font-semibold hover:text-indigo-600 transition-colors">
                  0942 063 227
                </a>
                <p className="text-xs text-slate-400 mt-1">{current.hotlineTime}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
