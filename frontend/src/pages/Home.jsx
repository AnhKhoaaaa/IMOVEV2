import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
      <h1>IMOVE</h1>
      <p>Plan your Singapore transit trip in minutes. Get day-by-day routes with real transport times and costs — no guessing.</p>
      <Link to="/plan">
        <button style={{ marginTop: 24, padding: '12px 32px', fontSize: 16 }}>Start Planning</button>
      </Link>
    </main>
  )
}
