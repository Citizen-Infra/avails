import { Routes, Route } from 'react-router'
import Landing from './pages/Landing'
import PollView from './pages/PollView'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/p/:did/:rkey" element={<PollView />} />
    </Routes>
  )
}
