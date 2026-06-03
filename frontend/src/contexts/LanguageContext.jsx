import { createContext, useContext, useState } from 'react'

const LanguageContext = createContext({ lang: 'en', toggleLang: () => {} })

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('imove_lang') ?? 'en' } catch { return 'en' }
  })

  const toggleLang = () => {
    const next = lang === 'en' ? 'vi' : 'en'
    setLang(next)
    try { localStorage.setItem('imove_lang', next) } catch {}
  }

  return (
    <LanguageContext.Provider value={{ lang, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLang() {
  return useContext(LanguageContext)
}

/** Returns a t(key, ...args) function scoped to the current language. */
export function useT() {
  const { lang } = useLang()
  function t(key, ...args) {
    const T = lang === 'vi' ? VI : EN
    const val = T[key]
    if (val === undefined) return key
    if (typeof val === 'function') return val(...args)
    return val
  }
  return { t, lang }
}

/* ── Translations ─────────────────────────────────────────────────── */

const EN = {
  /* ── Header ──────────────────────── */
  newTrip: 'New Trip',
  signIn: 'Sign in',
  signOut: 'Sign out',

  /* ── Auth modal ───────────────────── */
  signInTitle: 'Sign in',
  signUpTitle: 'Create account',
  signInDesc: 'Save your trips and access them anytime',
  signUpDesc: 'Create a free account to save and manage your trips',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  passwordHint: '(min. 6 characters)',
  displayNameLabel: 'Display name',
  displayNamePlaceholder: 'Your name',
  processingBtn: 'Processing…',
  signInBtn: 'Sign in',
  createAccountBtn: 'Create account',
  noAccount: "Don't have an account? Sign up",
  alreadyAccount: 'Already have an account? Sign in',
  continueWithout: 'Continue without signing in',
  checkEmailTitle: 'Check your email',
  checkEmailDesc: (email) =>
    `We sent a confirmation link to ${email}. Click it to activate your account, then sign in.`,
  closeBtn: 'Close',
  passwordTab: 'Password',
  magicLinkTab: 'Magic Link',
  sendMagicLinkBtn: 'Send magic link',
  signInWithGoogle: 'Sign in with Google',

  /* ── Home ────────────────────────── */
  yourItineraries: 'Your itineraries',
  welcomeBack: 'Welcome back',
  welcomeUser: (name) => `Welcome back, ${name}!`,
  tripsCount: (n) => `${n} trip${n !== 1 ? 's' : ''} saved`,
  happeningToday: (n) => `${n} happening today`,
  upcomingCount: (n) => `${n} upcoming`,
  createNewItinerary: 'Create New Itinerary',
  imoveRoute: 'IMOVE Route',
  liveToday: 'Live today',
  readyLabel: 'Ready',
  nextItinerary: 'Next itinerary',
  singaporePlanner: 'Singapore planner',
  homeStatTrips: 'Trips',
  homeStatToday: 'Today',
  homeStatUpcoming: 'Upcoming',
  travelWorkspace: 'Travel workspace',
  travelWorkspaceDesc: 'Plan, reopen, and continue your saved IMOVE itineraries.',
  previewLabel: 'Preview',
  previewMeta: '3 days · 8 stops · transit ready',
  routePointAirport: 'Airport',
  routePointMrt: 'MRT Blue Line',
  routePointMarina: 'Marina Bay',
  landingHeroEyebrow: 'Singapore public transport planner',
  landingHeroLine1: 'Transit Planning Made',
  landingHeroEasy: 'Easy',
  landingHeroDesc:
    'IMOVE helps first-time Singapore travelers turn a list of places into a day-by-day itinerary with verified MRT, bus, walking time, cost, and live disruption support.',
  landingHeroCta: 'Start transit planning',
  landingHeroStatLive: 'live transit checks',
  landingHeroStatAgents: 'planning agents',
  landingHeroStatFake: 'estimated routes',
  landingSavedEyebrow: 'Your workspace',
  landingSavedTitle: 'Continue your saved itineraries',
  landingInnovativeEyebrow: 'Innovative transit planning',
  landingInnovativeTitle: 'Built for tourists who need more than a static map',
  landingFeatureRoutingTitle: 'Verified MRT and bus routes',
  landingFeatureRoutingDesc:
    'Every leg is planned with real public transport routing data instead of guessed travel times.',
  landingFeatureAlertsTitle: 'Realtime disruption awareness',
  landingFeatureAlertsDesc:
    'IMOVE watches for MRT, bus, weather, and service issues that can affect today’s itinerary.',
  landingFeatureAgentsTitle: 'Adaptive multi-agent planning',
  landingFeatureAgentsDesc:
    'Planning, adaptation, and memory agents work together to suggest practical route changes.',
  landingStepsEyebrow: 'Book easy 3 steps',
  landingStepsTitle: 'Create a Singapore itinerary that already knows how you will move',
  landingStepPlacesTitle: 'Choose your places',
  landingStepPlacesDesc:
    'Add attractions, food spots, and neighborhoods you want to visit across one or more days.',
  landingStepPlanTitle: 'Generate transport-aware days',
  landingStepPlanDesc:
    'IMOVE orders stops and attaches MRT, bus, walking time, cost, and route details to each leg.',
  landingStepAdaptTitle: 'Navigate and adapt',
  landingStepAdaptDesc:
    'When a line delay, weather change, or route issue appears, the app can propose a safer swap.',
  landingServicesEyebrow: 'IMOVE best services',
  landingServicesTitle: 'Public transport support from planning to trip day',
  landingServiceRail: 'Rail routing',
  landingServiceBus: 'Bus options',
  landingServiceLive: 'Active alerts',
  landingServiceVerified: 'No fake fallback',
  landingDiscoverEyebrow: 'Discover our features',
  landingDiscoverTitle: 'Designed around Singapore transit realities',
  landingDiscoverMapTitle: 'Map-linked itinerary',
  landingDiscoverMapDesc:
    'Review every day beside route lines, stops, and transport mode markers.',
  landingDiscoverWeatherTitle: 'Weather-aware replanning',
  landingDiscoverWeatherDesc:
    'Outdoor-heavy plans can be adjusted when forecast or rain risk changes.',
  landingDiscoverBudgetTitle: 'Fare and walking context',
  landingDiscoverBudgetDesc:
    'See cost, active time, and walking distance before committing to a route.',
  landingDiscoverMemoryTitle: 'Learns from feedback',
  landingDiscoverMemoryDesc:
    'Saved feedback helps future plans better match your transport preferences.',
  landingReadyEyebrow: 'Ready for your Singapore trip plan',
  landingReadyTitle: 'Plan confidently even if you do not know MRT, bus, or local geography',
  landingReadyDesc:
    'Start with places you care about. IMOVE turns them into a transport-first itinerary and keeps the plan flexible when the real world changes.',
  landingReadyCardTitle: 'Solo and small-group friendly',
  landingReadyCardDesc:
    'Best for travelers visiting Singapore for the first time or anyone who wants a clearer transit plan.',
  landingFooterDesc:
    'IMOVE is a transport-first travel planner for Singapore, combining itinerary planning with realtime public transport adaptation.',
  landingFooterExplore: 'Explore',
  landingFooterPlanner: 'Planner',
  landingFooterTrips: 'Saved trips',
  landingFooterAlerts: 'Transit alerts',
  landingFooterSupport: 'Support',
  landingFooterContact: 'Contact',
  landingFooterMessage: 'Send a message',
  landingContactName: 'Name',
  landingContactEmail: 'Email',
  landingContactMessage: 'How can we help?',
  landingContactSend: 'Send',
  filter_All: 'All',
  filter_Today: 'Today',
  filter_Upcoming: 'Upcoming',
  filter_Drafts: 'Drafts',
  filter_Past: 'Past',
  noTripsTitle: 'Plan your Singapore adventure',
  noTripsDesc: 'Create your first trip with real MRT and bus routes, timed itineraries, and AI-powered suggestions.',
  startPlanning: 'Start Planning',
  planNewTrip: 'Plan a new trip',
  freshItinerary: 'Start a fresh itinerary',
  openBtn: 'Open',
  startTripBtn: 'Start Trip',
  liveLabel: 'Live',
  startsTodayTitle: 'Your trip to Singapore starts today!',
  startsTodayDesc: "Ready to explore? We'll navigate you through your itinerary.",
  laterBtn: 'Later',
  readyToNavigate: 'Ready to navigate',
  noTripsCategory: 'No trips in this category yet.',
  dest: 'Dest.',
  savedLabel: 'Saved',
  daysUnit: (n) => `${n} day${n !== 1 ? 's' : ''}`,
  stopsUnit: (n) => `${n} stop${n !== 1 ? 's' : ''}`,

  /* ── Planner — mode chooser ────────── */
  planYourTrip: 'Plan your Singapore trip',
  choosePlanMethod: 'Choose how to create your itinerary',
  buildYourselfTitle: 'Build it yourself',
  buildYourselfDesc:
    'Choose each place you want to visit — the system suggests transport between stops and you can customise freely.',
  recommendedBadge: 'Recommended',
  tag_freeChoice: 'Free choice',
  tag_transport: 'Transport suggestions',
  tag_customizable: 'Customizable',
  planWithAITitle: 'Plan with AI',
  planWithAIDesc:
    "Enter your preferences and let AI suggest an itinerary. Great when you're not sure where to go.",
  changeMethod: 'Change method',

  /* ── Planner — manual ──────────────── */
  manualHeaderLabel: 'Build your own itinerary',
  manualHeaderSub: 'Add places and choose transport between them',
  tripInfoSection: 'Trip info',
  tripNameLabel: 'Trip name',
  tripNamePlaceholder: 'E.g. Singapore 4D3N Adventure',
  flexibleLabel: 'Flexible',
  specificDatesLabel: 'Specific dates',
  flexibleHint: 'Flexible dates — set them later from the trip page.',
  numDaysLabel: 'Duration',
  placesSection: (n) => `Places (${n})`,
  clickToChange: 'Click a badge to change transport',
  noPlacesTitle: 'No places added yet',
  noPlacesHint: 'Click "Add place" below to get started',
  addPlaceBtn: 'Add place',
  searchPlaceTitle: 'Search & add a place',
  createTripBtn: (n) => `Create Itinerary (${n} place${n !== 1 ? 's' : ''})`,
  addAtLeastOne: 'Add at least 1 place to continue',
  creatingTrip: 'Creating your trip…',

  /* ── Planner — AI ──────────────────── */
  aiHeaderLabel: 'AI Planning',
  aiHeaderSub: 'AI will suggest an itinerary based on your preferences',
  whenGoingLabel: 'When are you going?',
  flexibleDatesHint: 'Flexible dates — set them later from the trip page.',
  preferencesLabel: 'Preferences',
  travellingWithLabel: 'Travelling with',
  travelStyleLabel: 'Travel style',
  tripPaceLabel: 'Trip pace',
  aiHint:
    "We'll curate the best places for you based on your travel style and pace, then build a full day-by-day itinerary with real MRT and bus routes.",
  planWithAIBtn: 'Plan with AI',
  planningBtn: 'Planning your trip…',
  selectStartDate: 'Please select a start date to continue',

  /* ── Planner — confirm step ────────── */
  planReady: 'Plan ready!',
  saveItinerary: 'Save your itinerary?',
  startOver: 'Start Over',
  saveAndView: 'Save & View Itinerary',

  /* ── Place search ──────────────────── */
  popularPlaces: 'Popular places in Singapore',
  searchPlaceholder: 'Search places in Singapore…',
  addedBtn: 'Added',
  addBtn: 'Add',
  limitedData: 'Limited data',
  noResults: (q) => `No places found for "${q}"`,
  loadingPlaces: 'Loading places…',
  statusToday: 'Happening Today',
  or: 'or',
  flexibleDates: 'Flexible dates',

  /* ── Transport ─────────────────────── */
  transport_walk: 'Walk',
  transport_bus: 'Bus',
  transport_mrt: 'MRT',

  /* ── Companions ────────────────────── */
  comp_solo: 'Solo',
  comp_family: 'Family',
  comp_couple: 'Couple',
  comp_friends: 'Friends',
  comp_elderly: 'Elderly',

  /* ── Travel styles ─────────────────── */
  style_cultural: 'Cultural',
  style_classic: 'Classic',
  style_nature: 'Nature',
  style_cityscape: 'Cityscape',
  style_historical: 'Historical',

  /* ── Pace ──────────────────────────── */
  pace_ambitious: 'Ambitious',
  pace_moderate: 'Moderate',
  pace_relaxed: 'Relaxed',
}

const VI = {
  /* ── Header ──────────────────────── */
  newTrip: 'Chuyến mới',
  signIn: 'Đăng nhập',
  signOut: 'Đăng xuất',

  /* ── Auth modal ───────────────────── */
  signInTitle: 'Đăng nhập',
  signUpTitle: 'Tạo tài khoản',
  signInDesc: 'Lưu hành trình của bạn và truy cập mọi lúc',
  signUpDesc: 'Tạo tài khoản miễn phí để lưu và quản lý hành trình',
  emailLabel: 'Email',
  passwordLabel: 'Mật khẩu',
  passwordHint: '(tối thiểu 6 ký tự)',
  displayNameLabel: 'Tên hiển thị',
  displayNamePlaceholder: 'Tên của bạn',
  processingBtn: 'Đang xử lý…',
  signInBtn: 'Đăng nhập',
  createAccountBtn: 'Tạo tài khoản',
  noAccount: 'Chưa có tài khoản? Tạo ngay',
  alreadyAccount: 'Đã có tài khoản? Đăng nhập',
  continueWithout: 'Tiếp tục không đăng nhập',
  checkEmailTitle: 'Kiểm tra email của bạn',
  checkEmailDesc: (email) =>
    `Chúng tôi đã gửi link xác nhận đến ${email}. Nhấn vào link để kích hoạt tài khoản rồi đăng nhập lại.`,
  closeBtn: 'Đóng',
  passwordTab: 'Mật khẩu',
  magicLinkTab: 'Magic Link',
  sendMagicLinkBtn: 'Gửi magic link',
  signInWithGoogle: 'Đăng nhập với Google',

  /* ── Home ────────────────────────── */
  yourItineraries: 'Hành trình của bạn',
  welcomeBack: 'Chào mừng trở lại',
  welcomeUser: (name) => `Chào mừng trở lại, ${name}!`,
  tripsCount: (n) => `${n} hành trình đã lưu`,
  happeningToday: (n) => `${n} đang diễn ra hôm nay`,
  upcomingCount: (n) => `${n} sắp tới`,
  createNewItinerary: 'Tạo hành trình mới',
  imoveRoute: 'Tuyến IMOVE',
  liveToday: 'Đang chạy hôm nay',
  readyLabel: 'Sẵn sàng',
  nextItinerary: 'Hành trình kế tiếp',
  singaporePlanner: 'Bộ lập kế hoạch Singapore',
  homeStatTrips: 'Hành trình',
  homeStatToday: 'Hôm nay',
  homeStatUpcoming: 'Sắp tới',
  travelWorkspace: 'Không gian hành trình',
  travelWorkspaceDesc: 'Lên kế hoạch, mở lại và tiếp tục các hành trình IMOVE đã lưu.',
  previewLabel: 'Xem trước',
  previewMeta: '3 ngày · 8 điểm · sẵn sàng di chuyển',
  routePointAirport: 'Sân bay',
  routePointMrt: 'Tuyến MRT xanh',
  routePointMarina: 'Marina Bay',
  landingHeroEyebrow: 'Lập kế hoạch giao thông công cộng Singapore',
  landingHeroLine1: 'Transit Planning Made',
  landingHeroEasy: 'Easy',
  landingHeroDesc:
    'IMOVE giúp du khách lần đầu đến Singapore biến danh sách địa điểm thành lịch trình theo ngày với MRT, xe buýt, thời gian đi bộ, chi phí và hỗ trợ khi có gián đoạn.',
  landingHeroCta: 'Bắt đầu lập kế hoạch',
  landingHeroStatLive: 'kiểm tra transit trực tiếp',
  landingHeroStatAgents: 'agent lập kế hoạch',
  landingHeroStatFake: 'lộ trình ước đoán',
  landingSavedEyebrow: 'Không gian của bạn',
  landingSavedTitle: 'Tiếp tục các hành trình đã lưu',
  landingInnovativeEyebrow: 'Lập kế hoạch transit thông minh',
  landingInnovativeTitle: 'Dành cho du khách cần nhiều hơn một bản đồ tĩnh',
  landingFeatureRoutingTitle: 'Tuyến MRT và xe buýt xác thực',
  landingFeatureRoutingDesc:
    'Mỗi chặng được lập bằng dữ liệu định tuyến giao thông công cộng thật, không tự đoán thời gian.',
  landingFeatureAlertsTitle: 'Nhận biết gián đoạn realtime',
  landingFeatureAlertsDesc:
    'IMOVE theo dõi MRT, xe buýt, thời tiết và sự cố dịch vụ có thể ảnh hưởng lịch trình trong ngày.',
  landingFeatureAgentsTitle: 'Lập kế hoạch đa tác nhân thích nghi',
  landingFeatureAgentsDesc:
    'Planning, adaptation và memory agents phối hợp để gợi ý thay đổi tuyến thực tế hơn.',
  landingStepsEyebrow: 'Tạo lịch trình trong 3 bước',
  landingStepsTitle: 'Tạo lịch trình Singapore biết sẵn bạn sẽ di chuyển thế nào',
  landingStepPlacesTitle: 'Chọn địa điểm',
  landingStepPlacesDesc:
    'Thêm điểm tham quan, ăn uống và khu vực bạn muốn ghé trong một hoặc nhiều ngày.',
  landingStepPlanTitle: 'Tạo ngày có tính đến di chuyển',
  landingStepPlanDesc:
    'IMOVE sắp xếp điểm dừng và gắn MRT, bus, thời gian đi bộ, chi phí và chi tiết tuyến cho từng chặng.',
  landingStepAdaptTitle: 'Đi và thích nghi',
  landingStepAdaptDesc:
    'Khi có trễ tuyến, đổi thời tiết hoặc vấn đề lộ trình, app có thể đề xuất phương án thay thế.',
  landingServicesEyebrow: 'Dịch vụ nổi bật của IMOVE',
  landingServicesTitle: 'Hỗ trợ giao thông công cộng từ lúc lập kế hoạch đến ngày đi',
  landingServiceRail: 'Tuyến rail',
  landingServiceBus: 'Lựa chọn bus',
  landingServiceLive: 'Cảnh báo chủ động',
  landingServiceVerified: 'Không fallback bịa',
  landingDiscoverEyebrow: 'Khám phá tính năng',
  landingDiscoverTitle: 'Thiết kế xoay quanh thực tế transit tại Singapore',
  landingDiscoverMapTitle: 'Lịch trình gắn với bản đồ',
  landingDiscoverMapDesc:
    'Xem từng ngày cùng đường tuyến, điểm dừng và marker phương tiện.',
  landingDiscoverWeatherTitle: 'Đổi kế hoạch theo thời tiết',
  landingDiscoverWeatherDesc:
    'Lịch trình nhiều hoạt động ngoài trời có thể được điều chỉnh khi dự báo thay đổi.',
  landingDiscoverBudgetTitle: 'Ngữ cảnh chi phí và đi bộ',
  landingDiscoverBudgetDesc:
    'Xem chi phí, thời gian hoạt động và quãng đi bộ trước khi chọn tuyến.',
  landingDiscoverMemoryTitle: 'Học từ phản hồi',
  landingDiscoverMemoryDesc:
    'Phản hồi đã lưu giúp các kế hoạch sau khớp hơn với sở thích di chuyển của bạn.',
  landingReadyEyebrow: 'Sẵn sàng cho kế hoạch Singapore',
  landingReadyTitle: 'Tự tin di chuyển dù chưa quen MRT, bus hoặc địa lý Singapore',
  landingReadyDesc:
    'Bắt đầu từ những địa điểm bạn quan tâm. IMOVE biến chúng thành lịch trình ưu tiên di chuyển và giữ kế hoạch linh hoạt khi thực tế thay đổi.',
  landingReadyCardTitle: 'Phù hợp solo và nhóm nhỏ',
  landingReadyCardDesc:
    'Tốt nhất cho du khách lần đầu đến Singapore hoặc bất kỳ ai muốn có kế hoạch transit rõ ràng hơn.',
  landingFooterDesc:
    'IMOVE là travel planner ưu tiên giao thông công cộng tại Singapore, kết hợp lập lịch trình với thích nghi realtime.',
  landingFooterExplore: 'Khám phá',
  landingFooterPlanner: 'Planner',
  landingFooterTrips: 'Hành trình đã lưu',
  landingFooterAlerts: 'Cảnh báo transit',
  landingFooterSupport: 'Hỗ trợ',
  landingFooterContact: 'Liên hệ',
  landingFooterMessage: 'Gửi tin nhắn',
  landingContactName: 'Tên',
  landingContactEmail: 'Email',
  landingContactMessage: 'Bạn cần hỗ trợ gì?',
  landingContactSend: 'Gửi',
  filter_All: 'Tất cả',
  filter_Today: 'Hôm nay',
  filter_Upcoming: 'Sắp tới',
  filter_Drafts: 'Nháp',
  filter_Past: 'Đã qua',
  noTripsTitle: 'Lên kế hoạch khám phá Singapore',
  noTripsDesc:
    'Tạo chuyến đi đầu tiên với tuyến MRT và xe buýt thực tế, lịch trình theo giờ và gợi ý từ AI.',
  startPlanning: 'Bắt đầu lên kế hoạch',
  planNewTrip: 'Tạo chuyến đi mới',
  freshItinerary: 'Bắt đầu lịch trình mới',
  openBtn: 'Mở',
  startTripBtn: 'Bắt đầu',
  liveLabel: 'Trực tiếp',
  startsTodayTitle: 'Chuyến đi Singapore của bạn bắt đầu hôm nay!',
  startsTodayDesc: 'Sẵn sàng khám phá? Chúng tôi sẽ dẫn đường qua từng điểm trong lịch trình.',
  laterBtn: 'Để sau',
  readyToNavigate: 'Bắt đầu điều hướng',
  noTripsCategory: 'Chưa có hành trình nào trong danh mục này.',
  dest: 'Điểm đến',
  savedLabel: 'Đã lưu',
  daysUnit: (n) => `${n} ngày`,
  stopsUnit: (n) => `${n} điểm`,

  /* ── Planner — mode chooser ────────── */
  planYourTrip: 'Lên kế hoạch đến Singapore',
  choosePlanMethod: 'Chọn cách bạn muốn tạo hành trình',
  buildYourselfTitle: 'Tự tạo hành trình',
  buildYourselfDesc:
    'Tự chọn từng địa điểm — hệ thống gợi ý phương tiện di chuyển và bạn có thể tuỳ chỉnh theo ý muốn.',
  recommendedBadge: 'Đề xuất',
  tag_freeChoice: 'Tự do lựa chọn',
  tag_transport: 'Gợi ý phương tiện',
  tag_customizable: 'Tuỳ chỉnh được',
  planWithAITitle: 'Lên kế hoạch bằng AI',
  planWithAIDesc: 'Nhập sở thích và để AI gợi ý lịch trình. Phù hợp khi chưa biết ghé đâu.',
  changeMethod: 'Thay đổi phương thức',

  /* ── Planner — manual ──────────────── */
  manualHeaderLabel: 'Tự tạo hành trình',
  manualHeaderSub: 'Thêm địa điểm và chọn phương tiện di chuyển',
  tripInfoSection: 'Thông tin chuyến đi',
  tripNameLabel: 'Tên chuyến đi',
  tripNamePlaceholder: 'Ví dụ: Singapore 4 ngày 3 đêm',
  flexibleLabel: 'Linh hoạt',
  specificDatesLabel: 'Ngày cụ thể',
  flexibleHint: 'Ngày linh hoạt — có thể đặt sau từ trang chuyến đi.',
  numDaysLabel: 'Số ngày',
  placesSection: (n) => `Địa điểm (${n})`,
  clickToChange: 'Nhấn chip phương tiện để thay đổi',
  noPlacesTitle: 'Chưa có địa điểm nào',
  noPlacesHint: 'Nhấn "Thêm địa điểm" bên dưới để bắt đầu',
  addPlaceBtn: 'Thêm địa điểm',
  searchPlaceTitle: 'Tìm & thêm địa điểm',
  createTripBtn: (n) => `Tạo hành trình (${n} địa điểm)`,
  addAtLeastOne: 'Thêm ít nhất 1 địa điểm để tiếp tục',
  creatingTrip: 'Đang tạo hành trình…',

  /* ── Planner — AI ──────────────────── */
  aiHeaderLabel: 'Lập kế hoạch AI',
  aiHeaderSub: 'AI sẽ gợi ý lịch trình dựa trên sở thích của bạn',
  whenGoingLabel: 'Khi nào bạn đi?',
  flexibleDatesHint: 'Ngày linh hoạt — có thể đặt sau từ trang chuyến đi.',
  preferencesLabel: 'Sở thích',
  travellingWithLabel: 'Đi cùng ai',
  travelStyleLabel: 'Phong cách du lịch',
  tripPaceLabel: 'Nhịp độ chuyến đi',
  aiHint:
    'AI sẽ chọn địa điểm phù hợp nhất dựa trên phong cách và nhịp độ của bạn, rồi tạo lịch trình theo từng ngày với tuyến MRT và xe buýt thực tế.',
  planWithAIBtn: 'Lập kế hoạch bằng AI',
  planningBtn: 'Đang lên kế hoạch…',
  selectStartDate: 'Vui lòng chọn ngày khởi hành',

  /* ── Planner — confirm step ────────── */
  planReady: 'Kế hoạch sẵn sàng!',
  saveItinerary: 'Lưu hành trình của bạn?',
  startOver: 'Làm lại',
  saveAndView: 'Lưu & Xem lịch trình',

  /* ── Place search ──────────────────── */
  popularPlaces: 'Địa điểm nổi tiếng tại Singapore',
  searchPlaceholder: 'Tìm địa điểm tại Singapore…',
  addedBtn: 'Đã thêm',
  addBtn: 'Thêm',
  limitedData: 'Thiếu dữ liệu',
  noResults: (q) => `Không tìm thấy kết quả cho "${q}"`,
  loadingPlaces: 'Đang tải địa điểm…',
  statusToday: 'Đang diễn ra',
  or: 'hoặc',
  flexibleDates: 'Ngày linh hoạt',

  /* ── Transport ─────────────────────── */
  transport_walk: 'Đi bộ',
  transport_bus: 'Xe buýt',
  transport_mrt: 'MRT',

  /* ── Companions ────────────────────── */
  comp_solo: 'Solo',
  comp_family: 'Gia đình',
  comp_couple: 'Cặp đôi',
  comp_friends: 'Bạn bè',
  comp_elderly: 'Người cao tuổi',

  /* ── Travel styles ─────────────────── */
  style_cultural: 'Văn hoá',
  style_classic: 'Cổ điển',
  style_nature: 'Thiên nhiên',
  style_cityscape: 'Đô thị',
  style_historical: 'Lịch sử',

  /* ── Pace ──────────────────────────── */
  pace_ambitious: 'Nhiều điểm',
  pace_moderate: 'Vừa phải',
  pace_relaxed: 'Thư thả',
}

export { EN, VI }
