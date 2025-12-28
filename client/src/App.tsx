import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "./context/AuthContext.tsx"
import Login from "./pages/Login"
import Signup from "./pages/Signup"
import Chat from "./pages/Chat"

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/chat" /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/chat" /> : <Signup />} />
      <Route path="/chat" element={user ? <Chat /> : <Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/chat" />} />
    </Routes>
  )
}
