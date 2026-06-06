/**
 * Build a Grab passenger app deeplink with pre-filled pickup and dropoff.
 * The deeplink opens the Grab app directly to the booking screen.
 * If the app is not installed, the OS redirects to the App Store / Play Store.
 */
export function buildGrabDeeplink({ fromLat, fromLng, fromName, toLat, toLng, toName }) {
  const params = new URLSearchParams({
    screenType:           'BOOKING',
    sourceAddress:        fromName ?? '',
    sourceLatitude:       String(fromLat),
    sourceLongitude:      String(fromLng),
    destinationAddress:   toName ?? '',
    destinationLatitude:  String(toLat),
    destinationLongitude: String(toLng),
  })
  return `grab://open?${params.toString()}`
}

export function openGrab(params) {
  window.location.href = buildGrabDeeplink(params)
}
