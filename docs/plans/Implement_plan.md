# Implementation Plan - Fix Route Planning, DB Persistence, and UI Rendering Bugs

This plan outlines the solutions to address the major bugs and logic flaws identified in the route optimization, day distribution, database persistence, and frontend rendering systems.

## User Decisions Incorporated

1. **Day Assignment & Persistence (Option A)**:
   - Modify the `DayPlan` Pydantic model and API response to include `place_ids: list[str] = []`.
   - Update `_persist_trip_plan` and `_fetch_trip_from_db` to save and restore day/order details in the `trip_places` table (`day_number` and `order_in_day`).
   
2. **Hotel Location / Start Location Configuration (Option B)**:
   - Provide an optional `hotel` search field in the Planner form (debounced search using the existing `onemap.geocode()` service).
   - Pass optional `hotel_name`, `hotel_lat`, and `hotel_lng` coordinates to the backend planning agent.
   - Persist these hotel columns to the `trips` database table.
   - If provided:
     - Use the hotel as the daily start origin for route clustering and scheduling.
     - Generate a starting leg `hotel -> first_place` for each day.
   - If not provided (defaults to empty):
     - The first place of the day is the starting point at 09:00, with no artificial "hotel -> place" leg generated.

---

## Proposed Changes

### Database

#### [NEW] [014_trip_hotel_details.sql](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/supabase/migrations/014_trip_hotel_details.sql)
- Adds `hotel_name`, `hotel_lat`, and `hotel_lng` columns to the `trips` table.

---

### Backend Models

#### [MODIFY] [trip.py](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/backend/app/models/trip.py)

- **`DayPlan`**:
  - Add `place_ids: list[str] = []` to store the ordered sequence of place IDs assigned to each day.
- **`TripPlanRequest`**:
  - Add optional fields:
    - `hotel_name: Optional[str] = None`
    - `hotel_lat: Optional[float] = None`
    - `hotel_lng: Optional[float] = None`

---

### Backend Planning Agent

#### [MODIFY] [planning_agent.py](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/backend/app/agents/planning_agent.py)

- **`plan_trip` Signature**:
  - Accept optional `hotel_name`, `hotel_lat`, `hotel_lng`.
- **Special Hotel Place Representation**:
  - If hotel coordinates are provided, create a special `Place` object for the hotel:
    - `id="hotel"`, `name=hotel_name`, `lat=hotel_lat`, `lng=hotel_lng`, `dwell_minutes=0`, `category="Hotel"`.
    - Append this to the trip's flat `places` list (so it behaves like a normal place for routing, DB mapping, and frontend rendering).
- **Day Bucketing (`_day_bucketed_greedy` & `_distribute_days`)**:
  - Use the hotel coordinates as the `anchor` starting point for Day 1.
  - For Day 2+, use the hotel coordinates as the initial `last_pos` (start location) instead of the previous day's last sightseeing location.
- **`_distribute_days` Fallback when `optimize_order = False`**:
  - Pre-fetch routes for consecutive pairs in the user's manual list *first* to obtain the `route_durations` cache.
  - Pass the cache to `_distribute_days` so that opening hours, travel time, and day-end limits are respected even without order optimization.
- **Leg Construction (Step 6)**:
  - If a hotel is provided, prepend a leg from the hotel to the first place of `day_places` for each day (departing hotel at 09:00, arriving at first place at `09:00 + travel_time`).
  - Populate `place_ids` list inside each `DayPlan` returned in the response.

---

### Backend Routers

#### [MODIFY] [trips.py](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/backend/app/routers/trips.py)

- **`plan_trip` & `optimize_trip`**:
  - Pass hotel details to `planning_agent.plan_trip`.
  - Save hotel details to `trips` DB table and update the local `_trip_meta` cache.
- **`_persist_trip_plan`**:
  - Save `day_number` and `order_in_day` in `trip_places` for all places (except the hotel itself if saved separately, or save hotel with `day_number=NULL`).
- **`_fetch_trip_from_db`**:
  - Query `trip_places` and group places into days based on `day_number` (ordered by `order_in_day`).
  - Read `route_legs` and overlay them on the reconstructed days. This guarantees single-place days are correctly restored from DB.
  - Recover hotel details from the `trips` table to reconstruct the hotel `Place` object if present.

---

### Frontend

#### [MODIFY] [api.js](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/frontend/src/services/api.js)

- Add a service method for searching/geocoding hotels using `onemap.geocode` endpoint or the existing geocoding endpoint in the backend.

#### [MODIFY] [TripSetupModal.jsx](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/frontend/src/components/planner/TripSetupModal.jsx) / [Planner Pages](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/frontend/src/pages/Planner.jsx)

- Add an optional Hotel setup step/field in the Planner setup form.
- Use a debounced search input that queries the OneMap geocoding service.
- Store selected hotel details in the trip state and submit them to `POST /trips/{id}/plan`.

#### [MODIFY] [tripUtils.js](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/frontend/src/lib/tripUtils.js)

- **`buildTimeline`**:
  - Reconstruct timeline using `day.place_ids` and `day.legs`.
  - If a day has no legs but has place IDs (e.g. Day 2 has only 1 place), build the timeline with just that place.
  - Avoid rendering "No places yet" unless the day actually has 0 places in `place_ids`.

#### [MODIFY] [DayPlan.jsx](file:///d:/HCMUS_CNTT/KOAS_UNI_PROGRAM/HK2_2nd_YEAR/IMOVEV2/frontend/src/components/planner/DayPlan.jsx)

- Pass `place_ids` to `buildTimeline`.

---

## Verification Plan

### Automated Tests
- Run backend pytest suite: `pytest backend/tests`
- Add a new unit test for manual order planning verifying that it doesn't drop days.
- Add a unit test for single-place days verifying they persist and restore correctly from database mocks.

### Manual Verification
- Create a trip with 3 days and 3 places (1 place per day).
- Confirm that Day 2 and Day 3 show up on the UI with their respective places instead of showing "No places yet".
- Clear local memory cache (restart server) and reload the trip to verify that Day 2 and Day 3 are not lost.
- Add a hotel during setup and verify that a leg "Hotel -> First Sight" is generated for each day starting at 09:00.
- Leave hotel empty during setup and verify that the timeline starts at 09:00 directly at the first sight.
