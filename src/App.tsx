import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { RegistrationPage } from '@/features/registration/RegistrationPage'
import { ConfirmationPage } from '@/features/registration/ConfirmationPage'
import { CampsListPage } from '@/features/camps/pages/CampsListPage'
import { NewCampPage } from '@/features/camps/pages/NewCampPage'
import { CampLandingPage } from '@/features/camps/pages/CampLandingPage'
import { CampSettingsPage } from '@/features/camps/pages/CampSettingsPage'
import { RoomsPage } from '@/features/rooms/pages/RoomsPage'

function AdminRoute({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/r/:campId" element={<RegistrationPage />} />
          <Route path="/r/:campId/done" element={<ConfirmationPage />} />

          {/* Admin — all protected */}
          <Route path="/admin/camps" element={<AdminRoute><CampsListPage /></AdminRoute>} />
          <Route path="/admin/camps/new" element={<AdminRoute><NewCampPage /></AdminRoute>} />
          <Route path="/admin/camps/:id" element={<AdminRoute><CampLandingPage /></AdminRoute>} />
          <Route path="/admin/camps/:id/settings" element={<AdminRoute><CampSettingsPage /></AdminRoute>} />
          <Route path="/admin/camps/:id/rooms" element={<AdminRoute><RoomsPage /></AdminRoute>} />

          {/* Fallbacks */}
          <Route path="/admin" element={<Navigate to="/admin/camps" replace />} />
          <Route path="/" element={<Navigate to="/admin/camps" replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </TooltipProvider>
  )
}
