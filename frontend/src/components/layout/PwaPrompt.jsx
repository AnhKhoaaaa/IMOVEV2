import { useState, useEffect } from 'react'
import { WifiOff, Wifi, Download, X } from 'lucide-react'
import { useT } from '../../contexts/LanguageContext'

export default function PwaPrompt() {
  const { t } = useT()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showOfflineBanner, setShowOfflineBanner] = useState(!navigator.onLine)
  const [showOnlineToast, setShowOnlineToast] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setShowOfflineBanner(false)
      setShowOnlineToast(true)
      setTimeout(() => setShowOnlineToast(false), 3000)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowOfflineBanner(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault()
      setInstallPromptEvent(e)
      setShowInstallBanner(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!installPromptEvent) return
    installPromptEvent.prompt()
    const { outcome } = await installPromptEvent.userChoice
    if (outcome === 'accepted') {
      setShowInstallBanner(false)
    }
    setInstallPromptEvent(null)
  }

  const dismissInstall = () => {
    setShowInstallBanner(false)
  }

  return (
    <>
      {/* Offline Banner */}
      {showOfflineBanner && (
        <div className="fixed top-14 left-0 w-full bg-red-500 text-white px-4 py-2 flex items-center justify-center text-sm font-medium shadow-md z-[60] animate-in slide-in-from-top-2">
          <WifiOff className="w-4 h-4 mr-2" />
          {t('pwaOffline')}
        </div>
      )}

      {/* Online Toast */}
      {showOnlineToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-full flex items-center text-sm font-medium shadow-lg z-[60] animate-in fade-in zoom-in duration-300">
          <Wifi className="w-4 h-4 mr-2" />
          {t('pwaOnline')}
        </div>
      )}

      {/* Install Banner */}
      {showInstallBanner && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-96 bg-white rounded-2xl shadow-2xl p-4 z-[60] border border-slate-100 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <button 
            onClick={dismissInstall}
            className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
              <img src="/icons/icon-192.png" alt="IMOVE" className="w-10 h-10 object-contain rounded-lg shadow-sm" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 text-base">{t('pwaInstallTitle')}</h3>
              <p className="text-sm text-slate-500 mt-1 mb-3 leading-relaxed">
                {t('pwaInstallDesc')}
              </p>
              <div className="flex gap-2">
                <button 
                  onClick={handleInstallClick}
                  className="flex-1 bg-blue-600 text-white font-medium py-2 px-4 rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {t('pwaInstallBtn')}
                </button>
                <button 
                  onClick={dismissInstall}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-50 rounded-xl transition-colors"
                >
                  {t('pwaDismissBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
