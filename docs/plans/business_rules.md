# Business Rules: AI Adaptive Transit Agent System

## 1. System Overview & Core Proposition
The system is an AI-driven Adaptive Transit Agent focusing on real-time transit telemetry, weather forecasting, and incident management. Unlike traditional static trip planners, this system actively monitors and adapts active itineraries leg-by-leg based on live external factors to minimize traveler delays and disruptions.

---

## 2. Itinerary States & Lifecycle
An itinerary must transition through the following states, which dictate the background processing load:
* [cite_start]**`DRAFT`**: Created by the user but dates or venues are unconfirmed (e.g., Bali 7-Day Draft)[cite: 20, 21, 22]. No agent monitoring required.
* [cite_start]**`UPCOMING`**: Confirmed itinerary with dates in the future (e.g., Kyoto 5-Day Upcoming)[cite: 11, 14]. Periodic checking enabled (once every 24 hours).
* [cite_start]**`HAPPENING_TODAY`**: The current system date matches the `start_date` of the itinerary (e.g., Singapore 3-Day trip starting today)[cite: 8, 9, 17]. High-frequency agent background processing is activated.
* [cite_start]**`PAST`**: The itinerary's end date is prior to the current system date (e.g., Tokyo 6-Day Past)[cite: 36, 39]. Archival state, no processing.

---

## 3. Real-Time Trigger Mechanisms (Agent Core Logic)

### 3.1 Weather Disruption Engine (`Weather_API`)
* **Schedule**: Backend fetches a 3-hour localized weather forecast event loop for all coordinates within the active day's itinerary.
* **Threshold Rule**: An alert is triggered ONLY if the probability of precipitation (POP) is **greater than 70%** (`POP > 70%`) and the target venue contains the attribute `venue_type: "outdoor"`.
* **Agent Reaction**: 
  - LLM Agent queries the database for matching fallback indoor venues (e.g., Lau Pa Sat Hawker Centre) within a 5km radius[cite: 85].
  - Calculates the structural swap payload and computes the estimated impact on `Transit Cost` and `Active Time`[cite: 181, 183, 185].

### 3.2 Transit & Incident Disruption Engine (`Transit_Live_API`)
* **Schedule**: Triggered dynamically based on the user's real-time Geolocation telemetry sent by the frontend mobile/web client.
* **Proximity Rule**: Active checking for a specific travel chặng (Transit Leg) begins when the user's current GPS radius is **within 1km** of the scheduled transit station/boarding node.
* **Incident Threshold**: Triggered if line delays exceed **10 minutes** (`delay_time >= 10m`) or a `SIGNAL_FAULT` / `SERVICE_SUSPENDED` alert is broadcasted on the active route line.
* **Agent Reaction**:
  - LLM Agent evaluates parallel transport options (e.g., switching from MRT to Bus, or Public Transit to Ride-Hailing/Grab).
  - Generates Citymapper-style step-by-step navigation arrays for the alternative mode.

---

## 4. API Response Contracts & Payload Rules

When the LLM Agent generates an optimization or reroute alternative, the backend **MUST NOT** alter the core database state immediately. It must return a tentative proposal payload to the frontend containing a **Delta Update Block**.

### 4.1 Delta Computation Requirements
[cite_start]Every adaptive proposal sent to the frontend must explicitly compute and include the following telemetry delta fields based on baseline metrics (e.g., initial baseline: Active Time `1h 47m`, Transit Cost `S$4.65`, Walking Distance `1.21 km`)[cite: 184, 186, 189]:
* `delta_transit_cost`: The difference in currency (e.g., `+S$8.00` or `-S$1.20`) compared to the original leg cost.
* `delta_active_time`: The time saved or lost in minutes (e.g., `-15m` or `+20m`).
* `delta_walking_distance`: The physical change in walking distance metrics (meters or kilometers).

### 4.2 Data Payload Structure Expected by Frontend Focus Mode
For active navigation, the backend API must flatten the active day into sequential nodes (`legs`). Each leg contains:
1. `origin`: Current station node or GPS fallback anchor (e.g., `• YOU ARE HERE` at `$1.3521^{\circ}, 103.8198^{\circ}$`, `9.2 km to first stop`)[cite: 114, 115, 116].
2. `transit_details`: Citymapper-style step-by-step breakdown[cite: 117, 122, 128]:
   - `line_identifier`: (e.g., "MRT East West Line", "Bus 65").
   - `branding_color`: Hex code for UI rendering.
   - `platform_or_boarding_node`: Precise terminal/platform instructions.
   - `intermediate_stops`: Array of stop names for the inline accordion drawer.
3. `destination`: Target attraction card metadata (e.g., "1. Night Safari", Rating `9.1`, "Today Open 6:00 PM-12:00 AM", Editor's Pick Badge)[cite: 123, 124, 125, 126].

---

## 5. Offline & Fallback Data Policies
* [cite_start]**Local Cache Sync**: Upon transitioning a trip to `HAPPENING_TODAY`, the frontend fetches and caches the entire static baseline day layout structure to local storage[cite: 17].
* **Network Degradation Rule**: If the frontend client fails to emit GPS logs or loses socket connectivity, the UI must fallback to displaying the static database layout sequence and display a status state: `"Offline Mode - Displaying scheduled fallback itinerary"`.

---

## 6. User Consent & Database Mutation Flow
1. **State Isolation**: Proposals remain in memory or temporary cache states while the client views the notification banner.
2. **Commit Action**: The database records for the trip's `places` sequence and `transports` mapping are mutated **ONLY** when the client explicitly invokes an `HTTP POST` request to the `/api/itineraries/{id}/accept-swap` endpoint.
3. **Recalculation**: Post-mutation, the global `Trip Summary` table metrics (Active Time, Transit Cost, Walking Distance, Transfers) must automatically re-aggregate the sum of all current transit steps[cite: 181, 183, 185, 187, 188].