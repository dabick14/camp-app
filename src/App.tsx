import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { UserRoleProvider } from '@/features/auth/UserRoleContext'
import { LoginPage } from '@/pages/LoginPage'
import { PasswordResetPage } from '@/pages/PasswordResetPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { CampsListPage } from '@/features/camps/pages/CampsListPage'
import { NewCampPage } from '@/features/camps/pages/NewCampPage'
import { CampSettingsPage } from '@/features/camps/pages/CampSettingsPage'
import { RoomsPage } from '@/features/rooms/pages/RoomsPage'
import { CampLayout } from '@/features/camp-layout/CampLayout'
import { ParticipantListPage } from '@/features/participants/ParticipantListPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { AdminAddParticipantPage } from '@/features/admin-add-participant/AdminAddParticipantPage'
import { LeadersPage } from '@/features/leaders/LeadersPage'
import { LeaderRegisterPage } from '@/features/leader-register/LeaderRegisterPage'
import { LeaderRosterPage } from '@/features/leader-roster/LeaderRosterPage'
import { PaymentsPage } from '@/features/payments/PaymentsPage'
import { BatchDetailPage } from '@/features/payments/BatchDetailPage'

function AdminRoute({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requireRole="admin">{children}</ProtectedRoute>
}

function LeaderRoute({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requireRole="leader">{children}</ProtectedRoute>
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <UserRoleProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/login/reset" element={<PasswordResetPage />} />

            {/* Leader — registration + payment roster; the public self-select
                flow (/r/:campId) was retired and removed in the post-Day-C cleanup */}
            <Route path="/leader" element={<Navigate to="/leader/register" replace />} />
            <Route
              path="/leader/register"
              element={<LeaderRoute><LeaderRegisterPage /></LeaderRoute>}
            />
            <Route
              path="/leader/roster"
              element={<LeaderRoute><LeaderRosterPage /></LeaderRoute>}
            />

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
              <Route path="participants/new" element={<AdminAddParticipantPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="rooms" element={<RoomsPage />} />
              <Route path="leaders" element={<LeadersPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="payments/:batchId" element={<BatchDetailPage />} />
              <Route path="settings" element={<CampSettingsPage />} />
            </Route>

            {/* Fallbacks */}
            <Route path="/admin" element={<Navigate to="/admin/camps" replace />} />
            <Route path="/" element={<Navigate to="/admin/camps" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <Toaster />
        </UserRoleProvider>
      </BrowserRouter>
    </TooltipProvider>
  )
}
