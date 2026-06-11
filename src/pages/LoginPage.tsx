import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { LoginForm } from '@/features/auth/LoginForm'

export function LoginPage() {
  const navigate = useNavigate()

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return
      const snap = await getDoc(doc(db, 'admins', user.uid))
      if (snap.exists()) navigate('/admin/camps', { replace: true })
    })
  }, [navigate])

  return <LoginForm />
}
