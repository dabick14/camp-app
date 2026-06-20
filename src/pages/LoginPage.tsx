import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useUserRole } from '@/features/auth/UserRoleContext'
import { LoginForm } from '@/features/auth/LoginForm'

export function LoginPage() {
  const navigate = useNavigate()
  const role = useUserRole()
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    if (role.type === 'admin') {
      navigate('/admin/camps', { replace: true })
      return
    }
    if (role.type === 'leader') {
      navigate('/leader', { replace: true })
      return
    }
    if (role.type === 'none' && auth.currentUser) {
      // Signed in via Firebase Auth but no admin/leader doc (or leader deactivated).
      signOut(auth)
      setError('Your account is not active. Please contact your camp administrator.')
      setSigningIn(false)
    }
  }, [role, navigate])

  async function handleSubmit(email: string, password: string) {
    setError('')
    setSigningIn(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      // Redirect (or the inactive-account error) is handled by the effect
      // above once useUserRole() resolves the new auth state.
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      setError(
        code === 'auth/invalid-credential'
          ? 'Invalid email or password.'
          : 'Sign in failed. Please try again.',
      )
      setSigningIn(false)
    }
  }

  return <LoginForm onSubmit={handleSubmit} error={error} loading={signingIn} />
}
