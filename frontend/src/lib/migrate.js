const OLD_TRIPS_KEY = 'imove_trips'
const GUEST_TRIPS_KEY = 'imove_trips_guest'
const OLD_DATA_KEY = 'imove_trip_data'
const GUEST_DATA_KEY = 'imove_trip_data_guest'

function migrateTrips() {
  const old = localStorage.getItem(OLD_TRIPS_KEY)
  if (!old) return
  try {
    const oldTrips = JSON.parse(old)
    const existing = localStorage.getItem(GUEST_TRIPS_KEY)
    if (!existing) {
      localStorage.setItem(GUEST_TRIPS_KEY, old)
    } else {
      const existingTrips = JSON.parse(existing)
      const existingIds = new Set(existingTrips.map((t) => t.id))
      const merged = [...existingTrips, ...oldTrips.filter((t) => !existingIds.has(t.id))]
      localStorage.setItem(GUEST_TRIPS_KEY, JSON.stringify(merged))
    }
  } catch { /* ignore corrupt storage */ }
  localStorage.removeItem(OLD_TRIPS_KEY)
}

function migrateTripData() {
  const old = localStorage.getItem(OLD_DATA_KEY)
  if (!old) return
  try {
    if (!localStorage.getItem(GUEST_DATA_KEY)) {
      localStorage.setItem(GUEST_DATA_KEY, old)
    }
  } catch { /* ignore corrupt storage */ }
  localStorage.removeItem(OLD_DATA_KEY)
}

export function migrateLocalStorage() {
  try {
    migrateTrips()
    migrateTripData()
  } catch { /* never throw from migration */ }
}
