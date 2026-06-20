import { Navigate } from 'react-router-dom'
import { useUserRole } from '@/features/auth/UserRoleContext'

type RequireRole = 'admin' | 'leader' | 'any'

export function ProtectedRoute({
  requireRole,
  children,
}: {
  requireRole: RequireRole
  children: React.ReactNode
}) {
  const role = useUserRole()

  if (role.type === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    )
  }

  if (role.type === 'none') {
    return <Navigate to="/login" replace />
  }

  if (requireRole === 'admin' && role.type === 'leader') {
    return <Navigate to="/leader" replace />
  }

  if (requireRole === 'leader' && role.type === 'admin') {
    return <Navigate to="/admin/camps" replace />
  }

  return <>{children}</>
}
