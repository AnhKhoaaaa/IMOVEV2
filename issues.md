Backend:
1. thêm POI từ dữ liệu thật từ TIH API của Singapore
    **VẤN ĐỀ**: TIH API KHÔNG KHẢ DỤNG
    **THAY THẾ**: Sử dụng Claude để gen ra 500 địa điểm nổi tiếng của Sing, tuy nhiên dữ liệu bị hallucinate khá nhiều, sử dụng knowledge cá nhân, không qua APi bên ngoài do dataset của chính phủ thiếu dữ liệu, nên thu được độ chính xác dữ liệu chưa cao. 
    **=> Giải pháp**: Sử dụng code python để duyệt qua từng địa điểm, so sánh lat/lng với OneMap, nếu sai lệch lớn hơn 50m thì cập nhật, gán cờ Is_auditted = True, và nếu sai lệch lớn hơn 1km thì gán cờ offset_over_1km=True, nếu data sau này không thể sử dụng được, có thể gọi API Từ Google Map để điều chỉnh lại các vị trí offset_over_1km đó. 
    Tổng số địa điểm: 500 địa danh.
    Số địa điểm bị lệch trên 1km: 95 địa điểm (chiếm tỷ lệ 19.0%).
    Số địa điểm khớp chính xác ( 50m): 38 địa danh.
    Số địa điểm lệch vừa phải (50m - 1km): 367 địa danh.
    Số địa điểm lỗi (Failed / Missing): 0 địa danh! (Nhờ có thuật toán 5 Lớp, toàn bộ 500 địa điểm đều đã được định vị thành công thay vì bị báo lỗi bỏ qua như trước).

2. Tích hợp 500 địa điểm mới vào backend để kiểm tra logic chuyển đổi địa điểm và tạo plan hiện tại, thêm vào supabase
3. Thêm URL ảnh vào cho từng địa điểm.
4. Thêm chatbot AI.
5. Thêm deepLink Grab vào chế độ taxi.

- URL Ảnh và địa điểm chính xác: Chưa dùng được google places APi để làm nên thông tin vẫn chưa đúng, đã có file và kế hoạch để lấy, chỉ cần có API key
- CHat bot AI đã có plan nhưng chưa code.



Frontend:
3. Cập nhật cách bản đồ vẽ route trên map, hiện tại thì vẽ không đúng và nhìn cũng xấu
4. Bản đồ đánh số thứ tự sai, các node số thứ tự xấu.
5. Khi chọn vào các ngày cụ thể (day1, day2) thì chỉ vẽ các địa điểm của ngày đó trên bản đồ, không hiển thị hết.



17:36:30 INFO  Loaded 499 POIs from singapore_places.json
17:36:30 WARNING UNSPLASH_ACCESS_KEY not set — FOOD_BEVERAGE/SHOPPING fallback will be skipped (image_url=None for misses)
17:36:30 INFO  Supabase client ready
17:36:30 INFO  
── Phase 1: Wikipedia (499 POIs) ──
17:48:18 INFO  Wikipedia found 23 / 499                                                             
17:48:18 INFO  
── Phase 2: Unsplash (253 FOOD_BEVERAGE/SHOPPING misses) ──
17:48:18 INFO  Unsplash found 0, fallback used 0                                                    
17:48:18 WARNING 223 ATTRACTION/HERITAGE POIs have no image — see missing_images.txt
17:48:18 INFO  
── Writing singapore_places.json ──
17:48:18 INFO  Saved D:\HCMUS_CNTT\KOAS_UNI_PROGRAM\HK2_2nd_YEAR\IMOVEV2\backend\app\data\singapore_places.json
17:48:18 INFO  
── Upserting to Supabase ──
17:48:20 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:20 WARNING Supabase batch 0 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (merlion-park, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:20.07587+00, 2026-06-02 10:48:20.07587+00, https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Singap...).'}
17:48:20 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:20 WARNING Supabase batch 50 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (wheelock-place, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:20.450612+00, 2026-06-02 10:48:20.450612+00, null).'}
17:48:20 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:20 WARNING Supabase batch 100 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (berseh-food-centre, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:20.723359+00, 2026-06-02 10:48:20.723359+00, null).'}
17:48:21 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:21 WARNING Supabase batch 150 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (mandai-wildlife-bridge, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:20.990936+00, 2026-06-02 10:48:20.990936+00, null).'}
17:48:21 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:21 WARNING Supabase batch 200 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (junction-8-bishan, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:21.253039+00, 2026-06-02 10:48:21.253039+00, null).'}
17:48:21 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:21 WARNING Supabase batch 250 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (geylang-bahru-market, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:21.51563+00, 2026-06-02 10:48:21.51563+00, null).'}
17:48:21 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:21 WARNING Supabase batch 300 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (jurong-bird-park-old, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:21.778088+00, 2026-06-02 10:48:21.778088+00, null).'}
17:48:22 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:22 WARNING Supabase batch 350 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (lim-chee-guan, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:22.047322+00, 2026-06-02 10:48:22.047322+00, null).'}
17:48:22 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:22 WARNING Supabase batch 400 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (plaza-singapura-lvb, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:22.314607+00, 2026-06-02 10:48:22.314607+00, null).'}
17:48:22 INFO  HTTP Request: POST https://yetkobhaxpfyohxzdvxo.supabase.co/rest/v1/places?on_conflict=id&columns=%22id%22%2C%22image_url%22 "HTTP/2 400 Bad Request"
17:48:22 WARNING Supabase batch 450 failed: {'message': 'null value in column "name" of relation "places" violates not-null constraint', 'code': '23502', 'hint': None, 'details': 'Failing row contains (alexandra-road-food-trail, null, null, null, null, null, null, null, 00:00, 23:59, null, null, null, null, null, null, null, null, 2026-06-02 10:48:22.577454+00, 2026-06-02 10:48:22.577454+00, null).'}
17:48:22 ERROR 10 Supabase batch(es) failed                                                         

17:48:22 INFO  ═══ Seed complete ═══
17:48:22 INFO  Total POIs       : 499
17:48:22 INFO  With image_url   : 23
17:48:22 INFO  Missing (manual) : 223 ATTRACTION/HERITAGE
17:48:22 INFO  See              : D:\HCMUS_CNTT\KOAS_UNI_PROGRAM\HK2_2nd_YEAR\IMOVEV2\backend\missing_images.txt