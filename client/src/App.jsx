import { Routes, Route } from 'react-router'
import Landing from './pages/Landing'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/p/:did/:rkey" element={<div>Poll view — coming next</div>} />
    </Routes>
  )
}
