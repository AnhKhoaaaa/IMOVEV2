import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { LanguageProvider } from './contexts/LanguageContext'
import { AuthProvider } from './contexts/AuthContext'
import { migrateLocalStorage } from './lib/migrate'
import Home from './pages/Home'
import Planner from './pages/Planner'
import Trip from './pages/Trip'
import Settings from './pages/Settings'
import HomePreview from './pages/HomePreview'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Support from './pages/Support'
import Header from './components/layout/Header'
import ChatWidget from './components/chat/ChatWidget'
import PwaPrompt from './components/layout/PwaPrompt'

export default function App() {
  useEffect(() => { migrateLocalStorage() }, [])

  return (
    <LanguageProvider>
      <AuthProvider>
        <Header />
        <PwaPrompt />
        <ChatWidget />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/plan" element={<Planner />} />
          <Route path="/trip/:id" element={<Trip />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/home-preview" element={<HomePreview />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/support" element={<Support />} />
        </Routes>
      </AuthProvider>
    </LanguageProvider>
  )
}
