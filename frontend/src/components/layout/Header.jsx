import { Link } from 'react-router-dom'

export default function Header() {
  return (
    <header style={{ padding: '12px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 24 }}>
      <Link to="/" style={{ fontWeight: 700, fontSize: 20, textDecoration: 'none' }}>IMOVE</Link>
      <Link to="/plan">Plan a Trip</Link>
    </header>
  )
}
