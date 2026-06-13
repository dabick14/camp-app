import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { RegistrationPage } from '@/features/registration/RegistrationPage'
import { ConfirmationPage } from '@/features/registration/ConfirmationPage'
import { CampsListPage } from '@/features/camps/pages/CampsListPage'
import { NewCampPage } from '@/features/camps/pages/NewCampPage'
import { CampSettingsPage } from '@/features/camps/pages/CampSettingsPage'
import { RoomsPage } from '@/features/rooms/pages/RoomsPage'
import { CampLayout } from '@/features/camp-layout/CampLayout'
import { ParticipantListPage } from '@/features/participants/ParticipantListPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'

function AdminRoute({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}

function PaymentsPlaceholder() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      Payments — coming in Day 5
    </div>
  )
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

          {/* Admin — list + new camp */}
          <Route
            path="/admin/camps"
            element={<AdminRoute><CampsListPage /></AdminRoute>}
          />
          <Route
            path="/admin/camps/new"
            element={<AdminRoute><NewCampPage /></AdminRoute>}
          />

          {/* Per-camp — all wrapped by CampLayout */}
          <Route
            path="/admin/camps/:id"
            element={<AdminRoute><CampLayout /></AdminRoute>}
          >
            <Route index element={<ParticipantListPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="rooms" element={<RoomsPage />} />
            <Route path="payments" element={<PaymentsPlaceholder />} />
            <Route path="settings" element={<CampSettingsPage />} />
          </Route>

          {/* Fallbacks */}
          <Route path="/admin" element={<Navigate to="/admin/camps" replace />} />
          <Route path="/" element={<Navigate to="/admin/camps" replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </TooltipProvider>
  )
}
