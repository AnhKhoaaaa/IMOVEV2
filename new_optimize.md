Refactor the `optimize_trip` pipeline in the backend. Do not change any API contracts, request/response schemas, or unrelated logic.

Current flow to replace: _sort_places_greedy() → _distribute_days() (steps 2+4)

---

**New algorithm: Day-Bucketed Greedy with Time-Window Constraints**

**Pre-step — Classify each place using existing fields `best_time_start` / `best_time_end`:**
- `evening`: best_time_start >= "17:00"
- `day`: best_time_end <= "17:00" or no time constraint
- `overlap`: best_time_start < "17:00" AND best_time_end > "17:00"

**Pre-assign evening places to days** before running any greedy:
- Distribute evenly across trip days
- Tie-break by geographic proximity (Haversine centroid) to day places already loosely associated with that day

**Day-Bucketed Greedy — replaces both _sort_places_greedy() and _distribute_days():**
for each day in trip:
current_time = 09:00
current_pos = last place of previous day (or places[0] on day 1)
pool = unassigned day + overlap places
while current_time < 17:00 and pool not empty:
    candidates = places in pool where:
        best_time_start <= current_time + haversine_estimate <= best_time_end
        AND current_time + haversine_estimate + dwell_minutes <= 17:00
    
    if candidates is empty:
        candidates = entire pool  # fallback: distance-only

    pick closest place to current_pos from candidates (Haversine)
    assign to this day, update current_time and current_pos

append pre-assigned evening places for this day (17:00–22:00 slot)
run a second greedy pass (distance-only) within evening places of this day

**Travel time estimation (Haversine only — used exclusively inside greedy):**
estimated_minutes = haversine_km(a, b) / 0.3
This estimate is used only to determine greedy candidate eligibility. It is never stored or returned.

**After greedy is complete — Parallel OneMap fetch:**
- Collect all consecutive pairs (place_i, place_i+1) across all days
- Fire a single asyncio.gather() for all pairs simultaneously
- Cache each result by key: (place_id_a, place_id_b, transport_mode)
- Rebuild the schedule using real OneMap travel times (replace Haversine estimates)

**Fallback rules:**
- If a place has a hard time-window conflict (e.g., evening place but no evening slot available), assign it to end of the nearest available day and attach a warning flag — do not crash the pipeline
- If best_time_start / best_time_end is missing for any place, treat it as `day` type

**Keep unchanged:**
- Step 1: Validate + Gemini fallback for place resolution
- Step 5: Gemini warning generation for overloaded/underloaded days
- Step 6: LegResponse builder and TripPlan response structure
- All existing opening_hours checks inside schedule rebuild