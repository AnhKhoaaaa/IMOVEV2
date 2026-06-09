import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { LanguageProvider } from './contexts/LanguageContext'
import { AuthProvider } from './contexts/AuthContext'
import { migrateLocalStorage } from './lib/migrate'
import Home from './pages/Home'
import Planner from './pages/Planner'
import Trip from './pages/Trip'
import Settings from './pages/Settings'
import Header from './components/layout/Header'
import ChatWidget from './components/chat/ChatWidget'

export default function App() {
  useEffect(() => { migrateLocalStorage() }, [])

  return (
    <LanguageProvider>
      <AuthProvider>
        <Header />
        <ChatWidget />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/plan" element={<Planner />} />
          <Route path="/trip/:id" element={<Trip />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </AuthProvider>
    </LanguageProvider>
  )
}
