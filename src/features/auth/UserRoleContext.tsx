import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { withTimeout } from '@/lib/withTimeout'

export type UserRole =
  | { type: 'loading' }
  | { type: 'none' }
  | { type: 'error'; message: string }
  | { type: 'admin'; uid: string }
  | { type: 'leader'; uid: string; campId: string; subGroupId: string; subGroupName: string }

const UserRoleContext = createContext<UserRole>({ type: 'loading' })

export function useUserRole(): UserRole {
  return useContext(UserRoleContext)
}

const AUTH_TIMEOUT_MS = 12_000

// Resolves once per actual auth state change (sign-in / sign-out), not per
// render or per route — every consumer reads the same cached value via context.
export function UserRoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>({ type: 'loading' })

  // Top-level guard: if onAuthStateChanged never fires (auth emulator unreachable),
  // the loading state would hang forever. This timer catches that case independently
  // of whether the callback ever runs.
  useEffect(() => {
    const t = setTimeout(() => {
      setRole((current) => {
        if (current.type === 'loading') {
          return { type: 'error', message: 'Connection timed out. Check your internet and try again.' }
        }
        return current
      })
    }, AUTH_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRole({ type: 'none' })
        return
      }

      let adminSnap: Awaited<ReturnType<typeof getDoc>>
      let leaderSnap: Awaited<ReturnType<typeof getDoc>>
      try {
        ;[adminSnap, leaderSnap] = await withTimeout(
          Promise.all([
            getDoc(doc(db, 'admins', user.uid)),
            getDoc(doc(db, 'leaders', user.uid)),
          ]),
        )
      } catch (err) {
        setRole({ type: 'error', message: (err as Error).message ?? 'Connection failed.' })
        return
      }

      if (adminSnap.exists()) {
        if (leaderSnap.exists()) {
          console.warn(
            `User ${user.uid} has documents in both /admins and /leaders — admin role takes precedence.`,
          )
        }
        setRole({ type: 'admin', uid: user.uid })
        return
      }

      const leaderData = leaderSnap.data()
      if (leaderSnap.exists() && leaderData?.active === true) {
        setRole({
          type: 'leader',
          uid: user.uid,
          campId: leaderData.campId,
          subGroupId: leaderData.subGroupId,
          subGroupName: leaderData.subGroupName,
        })
        // Best-effort — never block login on this write.
        updateDoc(doc(db, 'leaders', user.uid), { lastLoginAt: serverTimestamp() }).catch((err) => {
          console.warn('Failed to update leader lastLoginAt', err)
        })
        return
      }

      setRole({ type: 'none' })
    })
  }, [])

  return <UserRoleContext.Provider value={role}>{children}</UserRoleContext.Provider>
}
