import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// After every client deploy the old tab still points at chunk files that no
// longer exist; the next lazy screen (Jobs board, Books…) then fails to load
// and the app goes blank (Mark 2026-09-11: "the current screen changes to
// blank"). Vite fires this event on that failure — reload once, fresh index.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  const key = 'adas_chunk_reload_at'
  const last = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - last > 15000) { sessionStorage.setItem(key, String(Date.now())); window.location.reload() }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
