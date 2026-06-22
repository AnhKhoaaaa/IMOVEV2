# Deployment & PWA Guide — IMOVEV2

> Nghiên cứu và đối chiếu với code hiện tại ngày 2026-06-15.

## 1. Kết luận kiến trúc

### Phương án phù hợp nhất hiện tại

| Thành phần | Nền tảng đề xuất | Lý do |
|---|---|---|
| Frontend React/Vite/PWA | **Vercel** | Deploy SPA rất nhanh, CDN + HTTPS sẵn có, preview deployment tiện, phù hợp PWA |
| Backend FastAPI — demo/prototype | **Render** | Ít cấu hình nhất, chạy nguyên FastAPI + APScheduler hiện tại |
| Backend FastAPI — production ổn định | **Google Cloud Run + Cloud Scheduler** | Container chuẩn, region Singapore, scale tốt; lịch poll nên tách khỏi web process |
| Database/Auth/Realtime | **Supabase** | Giữ nguyên stack hiện tại, không cần tự vận hành PostgreSQL/Auth/WebSocket |

**Không nên chọn Vercel để chạy toàn bộ hệ thống hiện tại.** FastAPI có thể deploy lên Vercel, nhưng sẽ trở thành một Vercel Function có vòng đời và thời gian chạy giới hạn. `APScheduler` trong `backend/app/main.py` cần process sống liên tục để poll LTA và weather, nên không phù hợp với function tự scale lên/xuống.

### Chọn phương án nào?

1. **Cần demo nhanh, ít DevOps, chấp nhận cold start:** Vercel + Render Free + Supabase.
2. **Cần demo ổn định, không muốn sửa backend:** Vercel + Render paid always-on + Supabase.
3. **Cần production đúng nghĩa và có thể chỉnh scheduler:** Vercel + Cloud Run + Cloud Scheduler + Supabase.

Với mục tiêu hiện tại khoảng 10 người dùng đồng thời, **Vercel cho frontend là lựa chọn rõ ràng hơn Google Cloud**. Google Cloud chỉ thực sự đáng dùng cho backend khi cần độ ổn định, region Singapore và kiểm soát hạ tầng tốt hơn.

## 2. Các ràng buộc tìm thấy trong code

- Frontend là React Router SPA, có route `/`, `/plan`, `/trip/:id`, `/settings`.
- Frontend gọi backend qua `VITE_API_BASE_URL`.
- Frontend dùng Supabase trực tiếp qua `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`.
- Backend chạy hai lịch trong process:
  - LTA: mỗi 2 phút.
  - Weather: mặc định mỗi 120 phút.
- PWA **chưa được triển khai**:
  - Chưa có `vite-plugin-pwa`.
  - Chưa có web app manifest.
  - Chưa có service worker.
  - Logo hiện tại chưa có bộ icon PWA 192px/512px/maskable chuẩn.

## 3. Lưu ý quan trọng về Render Free

Render Free sẽ sleep sau 15 phút không có inbound traffic và có thể mất khoảng một phút để khởi động lại.

`/health` hiện tại là endpoint tốt để kiểm tra service có khỏe hay không, nhưng **cấu hình Health Check Path không phải keepalive**. Render chỉ gửi health check cho instance đang chạy; nó không đảm bảo Free instance luôn thức.

Khi instance sleep:

- API có cold start.
- `APScheduler` cũng dừng.
- Poll LTA mỗi 2 phút không còn hoạt động.
- Mục tiêu gửi adaptation alert trong dưới 3 phút không được đảm bảo.

Do đó, Render Free chỉ phù hợp cho demo. Không nên ghi nhận nó như một deployment production 24/7.

## 4. Triển khai PWA

### 4.1 Cài plugin

Chạy trong `frontend/`:

```bash
npm install -D vite-plugin-pwa workbox-window
```

`workbox-window` được dùng bởi React hook của plugin để hiển thị trạng thái offline/update.

### 4.2 Chuẩn bị icon

Tạo các file PNG trong `frontend/public/icons/`:

```text
icons/
  pwa-192x192.png
  pwa-512x512.png
  pwa-maskable-512x512.png
  apple-touch-icon-180x180.png
```

Icon maskable cần có vùng an toàn quanh logo để Android không cắt mất nội dung khi bo tròn.

### 4.3 Cấu hình `vite.config.js`

Thêm `VitePWA` vào danh sách plugin:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'imove-logo-transparent.png',
        'icons/apple-touch-icon-180x180.png',
      ],
      manifest: {
        name: 'IMOVE — Singapore Transit Planner',
        short_name: 'IMOVE',
        description: 'Plan and adapt public-transit trips across Singapore.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        orientation: 'portrait',
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
      },
    }),
  ],
})
```

`registerType: 'prompt'` phù hợp hơn `autoUpdate` cho IMOVE vì người dùng có thể đang nhập planner form. App nên hỏi trước khi reload sang phiên bản mới.

### 4.4 Hiển thị update prompt

Cấu hình `registerType: 'prompt'` không tự vẽ UI. Tạo một component nhỏ và mount nó ở `App.jsx`:

```jsx
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!offlineReady && !needRefresh) return null

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <aside role="status">
      <p>
        {needRefresh
          ? 'IMOVE có phiên bản mới.'
          : 'IMOVE đã sẵn sàng mở giao diện khi mất mạng.'}
      </p>
      {needRefresh && (
        <button onClick={() => updateServiceWorker(true)}>
          Cập nhật
        </button>
      )}
      <button onClick={close}>Đóng</button>
    </aside>
  )
}
```

Component thực tế nên dùng Button/Card hiện có và đặt fixed ở cạnh dưới màn hình.

### 4.5 Chiến lược offline

PWA không có nghĩa toàn bộ IMOVE chạy offline. Routing, weather, LTA và chatbot vẫn phụ thuộc API.

Nên cache:

- HTML/CSS/JS app shell.
- Logo, icon và ảnh tĩnh.
- Có thể cache có thời hạn cho danh sách địa điểm công khai.

Không nên cache chung:

- Request `POST`, `PATCH`, `DELETE`.
- Dữ liệu trip theo user.
- Alert realtime.
- Bus arrival, weather và routing result cần độ mới cao.
- Response có JWT hoặc dữ liệu cá nhân.

Khi offline, app nên mở được giao diện và hiển thị thông báo: “Cần kết nối mạng để lập tuyến và nhận dữ liệu giao thông trực tiếp.”

### 4.6 iOS: cách cài lên màn hình chính

Đường cài ổn định nhất trên iPhone:

1. Mở production URL bằng **Safari**.
2. Chọn **Share**.
3. Chọn **Add to Home Screen**.
4. Bật **Open as Web App** nếu tùy chọn này xuất hiện.
5. Chọn **Add**.

iOS không nên phụ thuộc vào nút install tự bật như Chrome Android. Trong app, nên có một banner hướng dẫn riêng khi phát hiện iPhone/iPad đang mở bằng browser và chưa chạy ở `standalone`.

### 4.7 Android: cách cài

Trên Chrome Android:

1. Mở production URL.
2. Chờ app đạt điều kiện installable.
3. Chọn **Install app** hoặc **Add to Home screen** trong menu Chrome.

Có thể bổ sung nút “Install IMOVE” bằng cách lắng nghe `beforeinstallprompt`. Nút này chỉ hiện trên browser có hỗ trợ event; iOS vẫn dùng hướng dẫn thủ công.

### 4.8 Điều kiện để Chrome xem app là installable

- Chạy qua HTTPS.
- Manifest có `name` hoặc `short_name`.
- Có icon 192px và 512px.
- Có `start_url`.
- `display` là `standalone`, `fullscreen`, `minimal-ui` hoặc `window-controls-overlay`.
- App chưa được cài trên thiết bị.

Vercel cung cấp HTTPS mặc định, nên đáp ứng phần hosting của PWA.

## 5. Deploy frontend lên Vercel

### 5.1 Thêm SPA rewrite

Tạo `frontend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

Rewrite này cần cho deep link như `/trip/abc`. Nếu thiếu, refresh trực tiếp route con có thể trả 404.

### 5.2 Tạo project

Trong Vercel:

1. Import GitHub repository.
2. Chọn **Root Directory** là `frontend`.
3. Framework Preset: **Vite**.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.

### 5.3 Environment variables

```text
VITE_API_BASE_URL=https://<backend-domain>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<supabase-anon-key>
```

Không đưa `SUPABASE_SERVICE_ROLE_KEY`, OneMap password, LTA key hoặc Gemini key vào biến `VITE_*`; mọi biến Vite đều có thể xuất hiện trong browser bundle.

### 5.4 Supabase Auth

Trong Supabase Auth URL Configuration:

- Site URL: Vercel production URL.
- Redirect URLs: production URL và các URL preview thực sự cần dùng.

Sau khi có custom domain, cập nhật Site URL sang domain chính thức.

## 6. Deploy backend lên Render

### 6.1 Cấu hình service

```text
Service type: Web Service
Root directory: backend
Build command: pip install -r requirements.txt
Start command: uvicorn app.main:app --host 0.0.0.0 --port $PORT
Health check path: /health
```

### 6.2 Environment variables

Tối thiểu:

```text
ONEMAP_EMAIL
ONEMAP_PASSWORD
LTA_API_KEY
GEMINI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FRONTEND_URL=https://<vercel-production-domain>
```

Tùy cấu hình:

```text
OPENWEATHER_API_KEY
GOOGLE_GENAI_USE_VERTEXAI
GOOGLE_CLOUD_PROJECT
GOOGLE_CLOUD_LOCATION
CHAT_MODEL
```

`FRONTEND_URL` không có dấu `/` cuối URL để khớp CORS origin.

## 7. Deploy backend lên Google Cloud Run

### 7.1 Hai cách xử lý APScheduler

**Cách A — ít sửa code, phù hợp chuyển hạ tầng trước:**

- Cloud Run `min-instances=1`.
- Instance-based billing, tức CPU luôn được cấp.
- `max-instances=1` để tránh mỗi instance chạy một bản APScheduler và poll trùng.

Cách này chạy được nhưng mất lợi ích scale nhiều instance và sẽ có chi phí instance luôn bật.

**Cách B — khuyến nghị production:**

- Bỏ lịch poll khỏi FastAPI lifespan.
- Tạo endpoint/job riêng cho poll LTA và weather.
- Dùng Cloud Scheduler gọi job bằng service account/OIDC.
- Cloud Run web API dùng request-based billing và có thể scale về 0.

Google khuyến nghị Cloud Scheduler để gọi Cloud Run theo lịch. Đây là kiến trúc đúng hơn cho polling định kỳ.

### 7.2 Container

Repository hiện chưa có `backend/Dockerfile`. Một cấu hình tối thiểu:

```dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
```

Nên lưu secret trong Google Secret Manager thay vì ghi trực tiếp vào image hoặc repository.

### 7.3 Region

Chọn `asia-southeast1` (Singapore) vì:

- Đối tượng dùng app ở Singapore.
- Các API giao thông và hành trình đều liên quan Singapore.
- Giảm latency giữa người dùng và backend.

### 7.4 Cấu hình tạm thời nếu giữ APScheduler

Ví dụ định hướng:

```bash
gcloud run deploy imove-api \
  --source backend \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling
```

Cần cấu hình environment variables/secrets riêng trước khi service có thể start vì `Settings` yêu cầu OneMap và LTA credentials.

## 8. Database production

- Tạo Supabase project production riêng.
- Chạy **toàn bộ** migration trong `supabase/migrations/` theo thứ tự, không chỉ `001_initial_schema.sql`.
- Kiểm tra RLS cho các bảng có dữ liệu user.
- Không dùng service-role key ở frontend.
- Test Auth redirect trên domain production.

## 9. Checklist kiểm thử production

### Web

- `/health` trả `200`.
- Tạo trip 3 địa điểm thành công.
- Refresh trực tiếp `/trip/<id>` không bị 404.
- Login/logout và Supabase redirect đúng domain.
- CORS chỉ cho domain frontend production.

### PWA

- Chrome DevTools > Application thấy Manifest và Service Worker.
- Lighthouse không báo thiếu icon/name/start URL.
- Android Chrome cài được.
- iPhone Safari cài được qua Add to Home Screen.
- Mở từ icon chạy ở chế độ standalone.
- Tắt mạng: app shell vẫn mở và báo rõ tính năng nào cần mạng.
- Deploy version mới: người dùng nhận prompt update, không bị reload giữa lúc nhập form.

### Background jobs

- Xác nhận LTA poll thực sự chạy mỗi 2 phút.
- Xác nhận không có hai scheduler cùng poll một job.
- Restart instance không tạo duplicate job.
- Theo dõi log khi OneMap/LTA/OpenWeather lỗi.

## 10. Quyết định đề xuất cho IMOVEV2

**Ngay bây giờ:**

```text
React/Vite/PWA -> Vercel
FastAPI + APScheduler -> Render
Postgres/Auth/Realtime -> Supabase
```

Dùng Render Free cho demo ngắn; dùng Render paid nếu cần alert hoạt động liên tục mà chưa muốn sửa backend.

**Khi chuyển sang production:**

```text
React/Vite/PWA -> Vercel
FastAPI API -> Google Cloud Run
LTA/weather schedule -> Google Cloud Scheduler
Postgres/Auth/Realtime -> Supabase
```

Không cần viết lại ứng dụng mobile. PWA vẫn dùng cùng React codebase; phần bổ sung chủ yếu là manifest, service worker, icon, install UX và kiểm thử trên thiết bị thật.

## 11. Nguồn chính thức

- [Vercel: Vite deployment và SPA rewrite](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel: FastAPI chạy như một Vercel Function](https://vercel.com/docs/frameworks/backend/fastapi)
- [Vercel: Function duration limits](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel: Hobby plan](https://vercel.com/docs/plans/hobby)
- [Google Cloud: Cloud Run billing và background execution](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [Google Cloud: chạy Cloud Run theo lịch bằng Cloud Scheduler](https://docs.cloud.google.com/run/docs/triggering/using-scheduler)
- [Google Cloud: Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Render: giới hạn Free web service](https://render.com/docs/free)
- [Render: Health Checks](https://render.com/docs/health-checks)
- [Apple: Add a website icon to iPhone Home Screen](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios)
- [Vite PWA: cài đặt và cấu hình plugin](https://vite-pwa-org.netlify.app/guide/)
- [web.dev: tiêu chí PWA installable](https://web.dev/articles/install-criteria)
