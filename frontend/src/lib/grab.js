const _MOBILE_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i

export function buildGoogleMapsUrl({ fromLat, fromLng, toLat, toLng }) {
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=driving`
}

/**
 * Attempt to open the Grab app with pickup/dropoff coordinates.
 *
 * Mobile with Grab installed  → opens Grab; onResult({ appOpened: true })
 * Mobile without Grab         → falls back to Google Maps; onResult({ appOpened: false })
 * Desktop                     → opens Google Maps immediately; onResult({ appOpened: false })
 *
 * @param {{ fromLat, fromLng, toLat, toLng, fromName, toName }} params
 * @param {({ appOpened: boolean }) => void} onResult  called once result is known
 */
export function openGrab({ fromLat, fromLng, toLat, toLng, fromName, toName }, onResult) {
  const mapsUrl = buildGoogleMapsUrl({ fromLat, fromLng, toLat, toLng })

  if (!_MOBILE_RE.test(navigator.userAgent)) {
    window.open(mapsUrl, '_blank', 'noopener,noreferrer')
    onResult?.({ appOpened: false })
    return
  }

  // Try native Grab deeplink — OS intercepts and opens app if installed
  window.location.href = `grab://open?screenType=BOOKING&source=external&pickup=${fromLat},${fromLng}&dropoff=${toLat},${toLng}`

  // After 1.5 s: page still visible means Grab is not installed → fall back to Google Maps
  setTimeout(() => {
    if (document.hidden) {
      onResult?.({ appOpened: true })
    } else {
      window.open(mapsUrl, '_blank', 'noopener,noreferrer')
      onResult?.({ appOpened: false })
    }
  }, 1500)
}
