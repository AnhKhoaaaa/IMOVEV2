# Kế hoạch xây dựng báo cáo LaTeX cho IMOVEV2

## 1. Mục tiêu

Xây dựng báo cáo cuối kỳ của dự án IMOVEV2 bằng LaTeX dựa trên outline bắt buộc trong `report.md`.

Báo cáo phải:

- Trả lời rõ dự án giải quyết vấn đề gì.
- Giải thích cách áp dụng Computational Thinking.
- Mô tả chính xác những gì hệ thống đã triển khai.
- Trình bày phân công và đóng góp của từng thành viên.
- Giữ nguyên toàn bộ heading cấp cao trong `report.md`.
- Ghi ID và họ tên người viết/review/cập nhật ở đầu mỗi section và subsection.
- Compile được thành PDF và không còn placeholder bắt buộc trước khi nộp.

## 2. Quyết định kỹ thuật

| Hạng mục | Quyết định |
|---|---|
| Ngôn ngữ báo cáo | Tiếng Việt; giữ thuật ngữ kỹ thuật tiếng Anh khi cần |
| LaTeX engine | XeLaTeX để hỗ trợ Unicode và tiếng Việt |
| Cấu trúc source | Modular, một file cho mỗi chapter |
| Document class | `report`, khổ giấy A4, font 12pt |
| Code listing | `listings`, không dùng `minted` để tránh yêu cầu `shell-escape` |
| Tài liệu tham khảo | `biblatex` với backend `biber` |
| Sơ đồ | TikZ hoặc file PDF/SVG/PNG đã render |
| Build command | `latexmk -xelatex main.tex` |
| Dữ liệu chưa có | Dùng placeholder `TODO_REQUIRED:*` và chặn phát hành cuối |

## 3. Cấu trúc thư mục LaTeX

Tạo source LaTeX trong thư mục `report/`:

```text
report/
├── main.tex
├── references.bib
├── README.md
├── config/
│   ├── packages.tex
│   ├── metadata.tex
│   └── commands.tex
├── chapters/
│   ├── 00-cover.tex
│   ├── 01-group-members.tex
│   ├── 02-idea.tex
│   ├── 03-problem-decomposition.tex
│   ├── 04-system-overview.tex
│   ├── 05-pattern-recognition.tex
│   ├── 06-abstraction.tex
│   ├── 07-system-algorithm-design.tex
│   ├── 08-implementation.tex
│   ├── 09-testing.tex
│   ├── 10-demo.tex
│   ├── 11-deployment.tex
│   ├── 12-logbook.tex
│   ├── 13-ai-declaration.tex
│   └── 14-conclusion.tex
├── diagrams/
│   ├── c4-context.pdf
│   ├── c4-container.pdf
│   ├── planning-pipeline.pdf
│   ├── scoring-pipeline.pdf
│   ├── adaptation-flow.pdf
│   └── memory-flow.pdf
└── images/
    ├── demo/
    ├── testing/
    └── workload/
```

Không lưu file build tạm như `.aux`, `.log`, `.toc`, `.out` trong Git. PDF cuối có thể được lưu theo yêu cầu nộp bài.

## 4. Thiết kế `main.tex`

`main.tex` chỉ điều phối cấu hình và các chapter:

```latex
\documentclass[12pt,a4paper,oneside]{report}

\input{config/packages}
\input{config/metadata}
\input{config/commands}

\begin{document}

\input{chapters/00-cover}
\pagenumbering{roman}
\tableofcontents
\listoffigures
\listoftables

\clearpage
\pagenumbering{arabic}
\input{chapters/01-group-members}
\input{chapters/02-idea}
\input{chapters/03-problem-decomposition}
\input{chapters/04-system-overview}
\input{chapters/05-pattern-recognition}
\input{chapters/06-abstraction}
\input{chapters/07-system-algorithm-design}
\input{chapters/08-implementation}
\input{chapters/09-testing}
\input{chapters/10-demo}
\input{chapters/11-deployment}
\input{chapters/12-logbook}
\input{chapters/13-ai-declaration}
\input{chapters/14-conclusion}

\printbibliography
\end{document}
```

## 5. Packages và định dạng

### 5.1. `config/packages.tex`

Sử dụng bộ package tối thiểu:

```latex
\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{vietnamese}

\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{longtable}
\usepackage{tabularx}
\usepackage{array}
\usepackage{float}
\usepackage{caption}
\usepackage{subcaption}
\usepackage{xcolor}
\usepackage{listings}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{hyperref}
\usepackage{cleveref}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{titlesec}
\usepackage[backend=biber,style=ieee]{biblatex}
\addbibresource{references.bib}
```

Thiết lập font theo thứ tự ưu tiên:

1. `TeX Gyre Termes`.
2. Nếu môi trường không có font trên, dùng một font Unicode serif có sẵn và ghi lại trong `report/README.md`.

### 5.2. Quy tắc trình bày

- Chương bắt đầu ở trang mới.
- Heading đánh số tự động.
- Bảng dài sử dụng `longtable` hoặc `tabularx`.
- Hình đặt gần đoạn văn tham chiếu.
- Mọi hình, bảng và listing đều có caption và label.
- Dùng `\ref{}` hoặc `\cref{}` thay vì ghi số hình thủ công.
- Không chụp ảnh code dài; dùng `lstlisting` hoặc trích đoạn ngắn.
- Không đưa API key, token hoặc thông tin bí mật vào báo cáo.

## 6. Metadata và placeholder bắt buộc

### 6.1. `config/metadata.tex`

Khai báo metadata ở một nơi duy nhất:

```latex
\newcommand{\ProjectTitle}{IMOVEV2}
\newcommand{\Semester}{TODO_REQUIRED:SEMESTER}
\newcommand{\CourseID}{TODO_REQUIRED:COURSE_ID}
\newcommand{\CourseName}{TODO_REQUIRED:COURSE_NAME}
\newcommand{\ClassID}{TODO_REQUIRED:CLASS_ID}
\newcommand{\GroupID}{TODO_REQUIRED:GROUP_ID}
\newcommand{\InstructorNames}{TODO_REQUIRED:INSTRUCTORS_AND_TAS}
\newcommand{\LatestUpdate}{TODO_REQUIRED:LATEST_UPDATE_DATE_TIME}
\newcommand{\DemoURL}{TODO_REQUIRED:YOUTUBE_DEMO_URL}
```

Thông tin thành viên phải được khai báo dưới dạng command hoặc bảng dữ liệu có cấu trúc:

```latex
% TODO_REQUIRED:MEMBER_1_ID
% TODO_REQUIRED:MEMBER_1_FULL_NAME
% TODO_REQUIRED:MEMBER_1_EMAIL
% TODO_REQUIRED:MEMBER_1_ROLE
```

### 6.2. Quy tắc placeholder

Mọi dữ liệu bắt buộc nhưng chưa có phải dùng đúng prefix:

```text
TODO_REQUIRED:
```

Các placeholder bắt buộc gồm:

- Semester, Course ID, Course Name, Class ID, Group ID.
- Instructor và TA.
- Student ID, full name, email, role của từng thành viên.
- Author/reviewer/updater của mỗi section và subsection.
- Demo YouTube URL.
- Workload percentage và working hours.
- Screenshot minh họa và screenshot công việc.
- Deployment URL nếu hệ thống đã deploy.

Trước khi phát hành PDF cuối, chạy:

```powershell
rg -n "TODO_REQUIRED:" report
```

Lệnh phải không trả về kết quả.

## 7. Macro tác giả cho section và subsection

Theo yêu cầu cập nhật ngày 2026-04-10 trong `report.md`, mọi heading cấp 2 và cấp 3 phải ghi ID và họ tên người phụ trách.

### 7.1. Macro

Định nghĩa trong `config/commands.tex`:

```latex
\newcommand{\sectionauthor}[3]{%
  \begin{quote}
    \small
    \textbf{#3:} #1 -- #2
  \end{quote}
}
```

### 7.2. Cách sử dụng

```latex
\section{Problem Statement}
\sectionauthor{TODO_REQUIRED:STUDENT_ID}{TODO_REQUIRED:FULL_NAME}{Author}

\subsection{Transit planning complexity}
\sectionauthor{TODO_REQUIRED:STUDENT_ID}{TODO_REQUIRED:FULL_NAME}{Reviewer}
```

Macro phải xuất hiện ngay sau mỗi `\section` và `\subsection`. Chapter không bắt buộc macro này trừ khi nhóm muốn ghi rõ chapter owner.

## 8. Ánh xạ outline `report.md` sang chapter

| Heading cấp cao bắt buộc | File chapter |
|---|---|
| Cover page | `00-cover.tex` |
| Table of Contents | Tạo tự động trong `main.tex` |
| Group Members | `01-group-members.tex` |
| Idea | `02-idea.tex` |
| Problem Analysis and Decomposition | `03-problem-decomposition.tex` |
| System Overview | `04-system-overview.tex` |
| Pattern Recognition | `05-pattern-recognition.tex` |
| Abstraction | `06-abstraction.tex` |
| System / Algorithm Design | `07-system-algorithm-design.tex` |
| Implementation | `08-implementation.tex` |
| Testing | `09-testing.tex` |
| Demo | `10-demo.tex` |
| Deployment | `11-deployment.tex` |
| Logbook: Plan and Actual Workload | `12-logbook.tex` |
| AI usage and declaration | `13-ai-declaration.tex` |
| Conclusion and Future Work | `14-conclusion.tex` |

Không đổi tên hoặc bỏ bất kỳ heading cấp cao nào trong bảng trên.

## 9. Kế hoạch nội dung từng chapter

### 9.1. Cover Page

Nội dung:

- Tên trường/khoa nếu được yêu cầu.
- Project Title.
- Semester, Course ID, Course Name, Class ID, Group ID.
- Danh sách Student IDs và Names.
- Instructors và TAs.
- Latest Update Date Time.

Không đánh số trang trên cover.

### 9.2. Group Members

Tạo bảng:

| Student ID | Student Full Name | Email | Roles / Responsibilities |
|---|---|---|---|

Vai trò phải phản ánh công việc thực tế, không chỉ dùng tên `Dev 1` đến `Dev 4`.

Nguồn hiện có:

- Bảng phân công sơ bộ trong `README.md`.
- Kế hoạch và tài liệu trong `docs/plans/`.

Thông tin cá nhân chưa có phải để `TODO_REQUIRED`.

### 9.3. Idea

Các section:

1. Problem Statement.
2. Product Vision.
3. Target Users.
4. Project Goals and Success Criteria.
5. Scope and Non-goals.

Nguồn chính:

- `docs/specs/mission.md`
- `README.md`

Nội dung trọng tâm:

- Khách du lịch chưa quen MRT/bus Singapore khó lập kế hoạch nhiều ngày.
- Google Maps giải tốt A-to-B nhưng không giải quyết trọn vẹn multi-day planning, adaptation và preference learning.
- IMOVE kết hợp Planning, Adaptation, Memory và Chat Agent.
- Chỉ hỗ trợ Singapore trong v1.

### 9.4. Problem Analysis and Decomposition

Phân rã bài toán thành:

1. User interaction và itinerary setup.
2. Curated place data và validation.
3. Multi-day scheduling.
4. Multimodal routing.
5. Context-aware scoring.
6. Live adaptation.
7. Preference learning.
8. Persistence và authentication.
9. AI-assisted natural language tasks.

Thêm bảng decomposition:

| Subproblem | Input | Processing | Output | Responsible module |
|---|---|---|---|---|

Thêm sơ đồ luồng từ user input đến `TripPlan`.

### 9.5. System Overview

Sử dụng nội dung đã xác minh từ `OverviewPatternAbstractionAlgorithm.md`:

- Main Stakeholders.
- Main Actors.
- Core Features.
- Innovation Highlights.
- Overall Architecture.

Không đưa các mục sau vào tính năng hoàn thành:

- Daily routine plan và Smart Override.
- Departure urgency `OK/HURRY/MISS`.
- Emotion/Health Processor.
- Full TSP solver.
- Realtime crowding scoring.

Các mục trên chỉ được nhắc trong Future Work.

### 9.6. Pattern Recognition

Trình bày các pattern thực tế:

- Startup validation.
- Structural Trip/Day/Leg pattern.
- Day-bucketed greedy scheduling.
- Relative normalization và weighted ranking.
- Context pattern từ mưa và giờ cao điểm.
- Implicit behavior pattern `BUS -> MRT` và `-> WALK`.
- External service failure/fallback pattern.
- LTA/weather polling pattern.

Thêm ít nhất:

- Một bảng tổng hợp pattern.
- Một sơ đồ greedy scheduling.
- Một sơ đồ memory learning.

### 9.7. Abstraction

Trình bày abstraction theo các tầng:

- Frontend components/hooks/API service.
- FastAPI routers.
- Planning, Adaptation, Memory, Chat Agents.
- OneMap, LTA, OpenWeather, Gemini, Scoring services.
- Pydantic models.
- Context abstraction.
- Supabase/in-memory/localStorage data layers.

Ghi rõ giới hạn:

- Chưa có provider interface chung cho nhiều AI.
- Chưa phải distributed microservice architecture.
- Một phần persistence logic vẫn nằm trong routers.

### 9.8. System / Algorithm Design

Bao gồm:

1. Technical Stack.
2. C4 Level 1.
3. C4 Level 2.
4. State and Data Flow.
5. Planning Agent pipeline.
6. Day-bucketed greedy algorithm.
7. Weighted scoring algorithm.
8. Adaptation algorithm.
9. Memory Agent rule-based learning.
10. Failure handling và limitations.

Nguồn chính:

- `OverviewPatternAbstractionAlgorithm.md`
- `docs/specs/techstack.md`
- Mã nguồn backend/frontend hiện tại.

Công thức weighted scoring:

```latex
\[
\operatorname{score}(m) =
w_d N_d(m) +
w_c N_c(m) +
w_w N_w(m) +
w_t N_t(m)
\]
```

Giải thích:

- `m`: transport mode.
- `N_d`, `N_c`, `N_w`, `N_t`: normalized duration, cost, walking và transfers.
- Trọng số được điều chỉnh theo context trước khi tính điểm.

### 9.9. Implementation

Trình bày ít nhất ba implementation challenge theo mẫu:

```text
Problem -> Cause -> Solution -> Result -> Remaining limitation
```

Các challenge đề xuất:

1. **Day-bucketed greedy có time-window constraints**
   - Phân bổ đều dwell time, xét opening hours và khoảng cách.
2. **OneMap multimodal routing và fallback**
   - Fetch song song, chuẩn hóa route, xử lý mode không khả dụng.
3. **Context-aware weighted scoring**
   - Chuẩn hóa tương đối và điều chỉnh weight.
4. **Adaptation theo LTA/weather**
   - Polling, tạo proposal và human-in-the-loop acceptance.
5. **Curated place dataset và image enrichment**
   - Data validation, sai lệch tọa độ và vấn đề ảnh.
6. **Frontend route editing**
   - Dirty state, keep order, optimize order và real/estimated route.

Nguồn:

- `issues.md`
- `To_fix.md`
- `new_optimize.md`
- `docs/plans/`
- Các commit hoặc PR đã được nhóm xác nhận.

Không sử dụng các ghi chú cũ như bằng chứng hoàn thành nếu implementation hiện tại không còn phù hợp.

### 9.10. Testing

Phân loại:

- Backend unit tests.
- Backend router/integration tests.
- External service client tests với mock.
- Frontend component tests.
- Frontend hooks/context tests.
- Manual/user testing nếu có.

Tạo bảng:

| Feature | Test level | Representative test | Expected result | Actual result |
|---|---|---|---|---|

Nguồn test:

- `backend/tests/`
- `frontend/src/__tests__/`

Kết quả test phải được chạy lại gần thời điểm xuất báo cáo. Không ghi số lượng passed/failed cố định trong source nếu chưa chạy lại.

Bug report và Improvement sử dụng:

- `issues.md`
- `improve.md`
- Known limitations trong `OverviewPatternAbstractionAlgorithm.md`

### 9.11. Demo

Kịch bản demo chuẩn:

1. Mở Home page.
2. Tạo itinerary mới.
3. Chọn ngày, khách sạn, preference và địa điểm.
4. Plan trip và xem route được đề xuất.
5. Xem Overview, Day view, map và route alternatives.
6. Đổi transport mode hoặc chỉnh thứ tự địa điểm.
7. Kích hoạt/check adaptation alert.
8. Chấp nhận hoặc từ chối proposal.
9. Lưu feedback/preferences.
10. Sử dụng chatbot.

Screenshot bắt buộc:

- Home/Landing.
- Planner.
- Trip Overview.
- Day itinerary.
- Map và route geometry.
- Alternative mode selection.
- Adaptation alert.
- Settings/preferences.
- Chatbot.

Mỗi screenshot cần:

- Caption.
- Một đoạn giải thích hành động và kết quả.
- Không lộ API key, email cá nhân hoặc dữ liệu nhạy cảm.

YouTube demo link dùng `\DemoURL`; giữ placeholder đến khi nhóm cung cấp URL.

### 9.12. Deployment

Trình bày:

- Frontend trên Vercel.
- Backend trên Render.
- Database/Auth/Realtime trên Supabase.
- Environment variables cần cấu hình.
- Migration process.
- Health check.
- Các giới hạn free tier.

Chỉ ghi deployed URL nếu có thể truy cập và đã được nhóm xác nhận.

Thêm sơ đồ deployment:

```text
User -> Vercel Frontend -> Render FastAPI -> Supabase / External APIs
```

### 9.13. Logbook: Plan and Actual Workload

Hai phần riêng:

1. Planned Workload.
2. Actual Workload.

Không cố làm cho plan giống actual nếu thực tế khác.

Bảng actual workload:

| Student ID | Full Name | Main Contributions | Percentage | Working Hours |
|---|---|---|---:|---:|

Điều kiện:

- Tổng percentage chính xác bằng 100%.
- Working hours được thành viên xác nhận.
- Mỗi thành viên có bằng chứng công việc hoặc screenshot task.
- Không suy luận percentage hoặc hours từ Git commit count.

Liệt kê công cụ quản lý:

- Git/GitHub.
- Công cụ giao tiếp nhóm.
- Công cụ quản lý task.
- Công cụ tài liệu.
- Công cụ AI đã sử dụng.

### 9.14. AI Usage and Declaration

Phân biệt hai nhóm:

1. **AI trong sản phẩm**
   - Gemini 2.5 Flash hỗ trợ parse địa điểm, suggestion, warning và chatbot.
   - Không dùng LLM làm nguồn quyết định route/cost/time chính.
2. **AI trong quá trình phát triển**
   - Ghi tên công cụ AI được sử dụng.
   - Ghi loại công việc được hỗ trợ.
   - Ghi cách nhóm kiểm tra đầu ra.

Tạo bảng:

| AI Tool | Purpose | Generated/Assisted Output | Human Verification |
|---|---|---|---|

Khai báo trung thực các vấn đề data hallucination đã gặp và cách kiểm tra bằng OneMap/Google Places nếu phù hợp.

### 9.15. Conclusion and Future Work

Conclusion phải trả lời:

- Nhóm đã triển khai thành công gì.
- Computational Thinking được áp dụng như thế nào.
- Nhóm học được gì.
- Những giới hạn còn tồn tại.

Future Work đề xuất:

- Departure urgency engine.
- Daily routine plan và Smart Override.
- Realtime crowding data.
- Nâng chất lượng curated place data và ảnh.
- Provider abstraction cho nhiều AI.
- Multi-city support.
- Cải thiện UX preference và localization tiếng Việt.
- Mở rộng monitoring, CI/CD và user testing.

Thêm đề xuất cho instructor/TA theo phản hồi thực tế của nhóm; không tạo nội dung giả.

## 10. Kế hoạch hình ảnh và sơ đồ

### 10.1. Sơ đồ bắt buộc

| Diagram | Chapter | Nội dung |
|---|---|---|
| Problem decomposition | Problem Analysis | Các subproblem và module |
| C4 Level 1 | System / Algorithm Design | User, IMOVE và external systems |
| C4 Level 2 | System / Algorithm Design | Frontend, Backend, Agents, Services, Supabase |
| Planning pipeline | Pattern/Algorithm | Validate, schedule, route, score, build plan |
| Scoring pipeline | Pattern/Algorithm | Extract, normalize, adjust, weighted sum |
| Adaptation flow | Algorithm | Alert, proposal, delta, user acceptance |
| Memory learning | Pattern Recognition | Feedback pattern và preference update |
| Deployment | Deployment | Vercel, Render, Supabase và APIs |

### 10.2. Quy trình tạo sơ đồ

1. Dùng Mermaid/TikZ/draw.io để tạo source.
2. Export sang PDF hoặc SVG chất lượng vector.
3. Đặt vào `report/diagrams/`.
4. Dùng tên file lowercase-kebab-case.
5. Thêm caption và label.
6. Kiểm tra sơ đồ đọc được khi in A4.

Ví dụ chèn hình:

```latex
\begin{figure}[H]
  \centering
  \includegraphics[width=\textwidth]{diagrams/c4-container.pdf}
  \caption{C4 Level 2 Container Diagram của IMOVEV2}
  \label{fig:c4-container}
\end{figure}
```

## 11. Tài liệu tham khảo và citation

Tạo `references.bib` cho:

- C4 Model.
- FastAPI documentation.
- React/Vite documentation.
- Supabase documentation.
- OneMap API.
- LTA DataMall.
- OpenWeather API.
- Gemini API.
- Các tài liệu về Haversine, greedy nearest-neighbor và weighted sum nếu được dùng để giải thích học thuật.

Không citation cho nhận xét nội bộ hoặc code của chính nhóm; thay vào đó tham chiếu file/module trong nội dung.

Mọi claim về API, framework hoặc thuật toán bên ngoài cần citation phù hợp.

## 12. Quy trình triển khai

### Giai đoạn 1: Scaffold

- Tạo cấu trúc `report/`.
- Tạo `main.tex`, config và toàn bộ chapter rỗng.
- Tạo metadata placeholder.
- Thiết lập XeLaTeX, bibliography, header/footer và code listing.
- Compile skeleton thành công.

### Giai đoạn 2: Nội dung kỹ thuật đã có

- Chuyển Idea và scope từ `mission.md`.
- Chuyển System Overview, Pattern Recognition, Abstraction và Algorithm Design từ `OverviewPatternAbstractionAlgorithm.md`.
- Viết Problem Decomposition.
- Thêm các sơ đồ kỹ thuật.

### Giai đoạn 3: Implementation và Testing

- Chọn các implementation challenge có bằng chứng mã nguồn.
- Chạy lại backend/frontend tests.
- Ghi kết quả test và bug report.
- Thêm improvement và limitations.

### Giai đoạn 4: Nội dung nhóm và demo

- Điền thông tin bìa/thành viên.
- Thêm phân công, workload và working hours.
- Chụp screenshot demo và task management.
- Điền demo URL và deployment URL.
- Viết AI declaration.

### Giai đoạn 5: Review và phát hành

- Review tính chính xác kỹ thuật.
- Review ngôn ngữ và format.
- Kiểm tra mọi section/subsection có author metadata.
- Xóa toàn bộ placeholder.
- Compile sạch và kiểm tra PDF.

## 13. Kiểm tra tự động và nghiệm thu

### 13.1. Lệnh build

```powershell
cd report
latexmk -xelatex main.tex
```

Nếu bibliography thay đổi:

```powershell
biber main
latexmk -xelatex main.tex
```

### 13.2. Kiểm tra placeholder

```powershell
rg -n "TODO_REQUIRED:" report
```

Kết quả bắt buộc rỗng trước khi nộp.

### 13.3. Kiểm tra heading và author metadata

Viết script hoặc kiểm tra thủ công để bảo đảm:

- Mỗi `\section{}` có một `\sectionauthor` ngay sau.
- Mỗi `\subsection{}` có một `\sectionauthor` ngay sau.
- Tất cả heading cấp cao trong `report.md` đều có chapter tương ứng.

### 13.4. Acceptance criteria

- [ ] XeLaTeX compile thành công.
- [ ] Không có undefined reference hoặc missing citation.
- [ ] Không còn `TODO_REQUIRED`.
- [ ] Có Table of Contents, List of Figures và List of Tables.
- [ ] Tất cả heading cấp cao của `report.md` được giữ nguyên.
- [ ] Mọi section/subsection có ID và họ tên người phụ trách.
- [ ] Mọi hình, bảng và listing có caption hoặc mô tả.
- [ ] Mọi screenshot demo có giải thích.
- [ ] Tổng workload percentage bằng 100%.
- [ ] Nội dung kỹ thuật khớp repository hiện tại.
- [ ] Future Work không bị mô tả như tính năng hoàn thành.
- [ ] PDF không chứa secret hoặc dữ liệu nhạy cảm.

## 14. Nguồn sự thật khi viết báo cáo

Ưu tiên nguồn theo thứ tự:

1. Mã nguồn và test hiện tại.
2. `OverviewPatternAbstractionAlgorithm.md`.
3. `docs/specs/mission.md`.
4. `docs/specs/techstack.md`.
5. `README.md`.
6. `docs/plans/`, `issues.md`, `To_fix.md`, `new_optimize.md`, `improve.md`.

Nếu tài liệu cũ mâu thuẫn với mã nguồn, sử dụng mã nguồn làm nguồn sự thật. Không đưa claim chưa được xác minh vào báo cáo.

## 15. Các dữ liệu nhóm phải cung cấp

Trước khi hoàn thiện báo cáo LaTeX, nhóm phải cung cấp:

- Semester, Course ID, Course Name, Class ID và Group ID.
- Instructor và TA.
- Student ID, full name, email và role của từng thành viên.
- Author/reviewer/updater cho từng section/subsection.
- Planned workload.
- Actual workload percentage và working hours.
- Screenshot bằng chứng công việc.
- Screenshot demo ứng dụng.
- YouTube demo URL.
- Deployment URL nếu có.
- Danh sách công cụ AI đã sử dụng trong quá trình phát triển.
- Đề xuất thực tế cho instructor và TA.

