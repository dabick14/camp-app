import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { auth } from '@/lib/firebase'

export function LogoutButton() {
  const navigate = useNavigate()

  async function handleLogout() {
    await signOut(auth)
    navigate('/login', { replace: true })
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5 text-muted-foreground">
      <LogOut className="h-3.5 w-3.5" />
      Log out
    </Button>
  )
}
