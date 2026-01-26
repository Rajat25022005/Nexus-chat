import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "./context/AuthContext"
import Login from "./pages/Login"
import Signup from "./pages/Signup"
import Chat from "./pages/Chat"
import Profile from "./pages/Profile"
import Landing from "./pages/Landing"
import Onboarding from "./pages/Onboarding"

export default function App() {
  const { token } = useAuth()

  return (
    <Routes>
      <Route path="/" element={token ? <Navigate to="/chat" /> : <Landing />} />
      <Route path="/login" element={token ? <Navigate to="/chat" /> : <Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/onboarding" element={token ? <Onboarding /> : <Navigate to="/" />} />
      <Route path="/chat" element={token ? <Chat /> : <Navigate to="/" />} />
      <Route path="/profile" element={token ? <Profile /> : <Navigate to="/" />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}
