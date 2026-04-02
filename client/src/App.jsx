import { Routes, Route } from 'react-router'
import Landing from './pages/Landing'
import PollView from './pages/PollView'
import About from './pages/About'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/about" element={<About />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/p/:did/:rkey" element={<PollView />} />
    </Routes>
  )
}
