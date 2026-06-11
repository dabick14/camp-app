import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { AdminCampsPage } from '@/pages/AdminCampsPage'
import { PublicRegistrationPage } from '@/pages/PublicRegistrationPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/r/:campId" element={<PublicRegistrationPage />} />
        <Route
          path="/admin/camps"
          element={
            <ProtectedRoute>
              <AdminCampsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/admin" element={<Navigate to="/admin/camps" replace />} />
        <Route path="/" element={<Navigate to="/admin/camps" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
