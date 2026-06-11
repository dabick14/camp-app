import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'

type AuthState = 'loading' | 'admin' | 'denied'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState('denied')
        return
      }
      const snap = await getDoc(doc(db, 'admins', user.uid))
      setState(snap.exists() ? 'admin' : 'denied')
    })
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    )
  }

  if (state === 'denied') {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
