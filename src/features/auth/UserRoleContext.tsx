import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'

export type UserRole =
  | { type: 'loading' }
  | { type: 'none' }
  | { type: 'admin'; uid: string }
  | { type: 'leader'; uid: string; campId: string; subGroupId: string; subGroupName: string }

const UserRoleContext = createContext<UserRole>({ type: 'loading' })

export function useUserRole(): UserRole {
  return useContext(UserRoleContext)
}

// Resolves once per actual auth state change (sign-in / sign-out), not per
// render or per route — every consumer reads the same cached value via context.
export function UserRoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole>({ type: 'loading' })

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRole({ type: 'none' })
        return
      }

      const [adminSnap, leaderSnap] = await Promise.all([
        getDoc(doc(db, 'admins', user.uid)),
        getDoc(doc(db, 'leaders', user.uid)),
      ])

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
