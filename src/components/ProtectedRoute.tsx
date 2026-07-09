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

  if (role.type === 'error') {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <p className="text-sm text-destructive">{role.message}</p>
          <button
            className="mt-4 rounded-md border px-4 py-2 text-sm hover:bg-muted"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
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
