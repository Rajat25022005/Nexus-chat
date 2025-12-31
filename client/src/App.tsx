import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "./context/AuthContext"
import Login from "./pages/Login"
import Signup from "./pages/Signup"
import Chat from "./pages/Chat"

export default function App() {
  const { token } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/chat" /> : <Login />} />
      <Route path="/signup" element={token ? <Navigate to="/chat" /> : <Signup />} />
      <Route path="/chat" element={token ? <Chat /> : <Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/chat" />} />
    </Routes>
  )
}
