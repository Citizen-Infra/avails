import { Routes, Route, Link } from 'react-router'
import ErrorBoundary from './components/ErrorBoundary'
import Landing from './pages/Landing'
import PollView from './pages/PollView'
import About from './pages/About'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import StandingAvailability from './pages/StandingAvailability'

function NotFound() {
  return (
    <div style={{ maxWidth: 480, margin: '100px auto', padding: 20, textAlign: 'center' }}>
      <h1 style={{ fontSize: 48, marginBottom: 8, color: '#1a1a1a' }}>404</h1>
      <p style={{ color: '#6b6560', marginBottom: 24 }}>This page doesn't exist.</p>
      <Link to="/" style={{ color: '#0d9488' }}>Go to Avails</Link>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/availability" element={<ErrorBoundary><StandingAvailability /></ErrorBoundary>} />
        <Route path="/p/:did/:rkey" element={<ErrorBoundary><PollView /></ErrorBoundary>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}
