import RouteCard from './RouteCard'

export default function DayPlan({ day, legs }) {
  return (
    <details open>
      <summary>Day {day}</summary>
      {legs.map((leg, i) => <RouteCard key={i} leg={leg} />)}
    </details>
  )
}
