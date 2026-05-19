import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Planner from './pages/Planner'
import Trip from './pages/Trip'
import Header from './components/layout/Header'

export default function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/plan" element={<Planner />} />
        <Route path="/trip/:id" element={<Trip />} />
      </Routes>
    </>
  )
}
