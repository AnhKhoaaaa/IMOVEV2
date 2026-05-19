export default function RouteCard({ leg }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, margin: '8px 0' }}>
      <div>
        {leg.transport_mode} · {leg.duration_minutes} min · SGD {leg.cost_sgd.toFixed(2)}
        {leg.is_estimated && <span title="Estimated value"> ~</span>}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        {leg.from_place_id} → {leg.to_place_id}
      </div>
    </div>
  )
}
