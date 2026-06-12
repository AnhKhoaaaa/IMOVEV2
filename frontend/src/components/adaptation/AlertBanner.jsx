import AlertActionCard from './AlertActionCard'

// dev25 P2 — AlertBanner is now a thin wrapper around the shared, presentational
// `AlertActionCard` (the full weather-swap + closing-risk + transport resolver). The card was
// extracted so the SAME interactive UI can render inline inside the chat stream (ChatWidget),
// while the Trip page keeps mounting it as a banner. Behaviour/DOM are identical — the existing
// AlertBanner tests pin both. See docs/plans/dev25.md §Phase 2.
//
// DEV25-BANNER-RETAINED: this banner mount is currently gated off on the Trip page
// (`ENABLE_TRIP_BANNERS=false`); the component is kept so it can be re-enabled. To restore the
// Trip-page banner, flip that flag — no change needed here.
export default function AlertBanner({ alert, tripId, onDismiss, onAdapted }) {
  return <AlertActionCard alert={alert} tripId={tripId} onDismiss={onDismiss} onAdapted={onAdapted} />
}
