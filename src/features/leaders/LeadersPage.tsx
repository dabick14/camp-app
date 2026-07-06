import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import type { Timestamp } from 'firebase/firestore'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { listLeaders } from './services/leaderService'
import type { Leader } from './types'
import { ProvisionLeaderModal } from './components/ProvisionLeaderModal'

const SET_LEADER_ACTIVE_URL =
  'https://us-central1-camp-app-119bb.cloudfunctions.net/setLeaderActive'

function fmtLastLogin(ts: Timestamp | undefined): string {
  if (!ts) return 'Never'
  return ts.toDate().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function LeadersPage() {
  const { id: campId } = useParams<{ id: string }>()
  const { subGroups } = useCampData()

  const [leaders, setLeaders] = useState<Leader[]>([])
  const [loading, setLoading] = useState(true)
  const [showProvisionModal, setShowProvisionModal] = useState(false)
  const [confirmToggleUid, setConfirmToggleUid] = useState<string | null>(null)
  const [busyUid, setBusyUid] = useState<string | null>(null)

  async function refetch() {
    if (!campId) return
    setLoading(true)
    const data = await listLeaders(campId)
    data.sort((a, b) => a.subGroupName.localeCompare(b.subGroupName))
    setLeaders(data)
    setLoading(false)
  }

  useEffect(() => {
    refetch()
  }, [campId])

  function handleProvisioned(subGroupName: string, email: string) {
    setShowProvisionModal(false)
    toast.success(`${email} added as coordinator for ${subGroupName}. A set-password email was sent.`)
    refetch()
  }

  async function handleToggleActive(leader: Leader) {
    const idToken = await getAuth().currentUser?.getIdToken()
    if (!idToken) {
      toast.error('Not authenticated. Please refresh and try again.')
      return
    }

    setBusyUid(leader.id)
    try {
      const res = await fetch(SET_LEADER_ACTIVE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ uid: leader.id, active: !leader.active }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? 'Failed to update coordinator')
      }

      setLeaders((prev) =>
        prev.map((l) => (l.id === leader.id ? { ...l, active: !leader.active } : l)),
      )
      toast.success(leader.active ? `${leader.subGroupName}'s coordinator deactivated` : `${leader.subGroupName}'s coordinator reactivated`)
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? 'Failed to update coordinator')
    } finally {
      setBusyUid(null)
      setConfirmToggleUid(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Coordinators</h1>
        <Button onClick={() => setShowProvisionModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add coordinator
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : leaders.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No coordinators yet.</p>
          <Button className="mt-4" onClick={() => setShowProvisionModal(true)}>
            Add your first coordinator
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Sub-group</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaders.map((leader) => (
              <TableRow key={leader.id}>
                <TableCell className="font-medium">{leader.displayName ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{leader.email}</TableCell>
                <TableCell>{leader.subGroupName}</TableCell>
                <TableCell>
                  <Badge variant={leader.active ? 'default' : 'secondary'}>
                    {leader.active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{fmtLastLogin(leader.lastLoginAt)}</TableCell>
                <TableCell className="text-right">
                  {confirmToggleUid === leader.id ? (
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs text-muted-foreground">
                        {leader.active ? 'Deactivate?' : 'Reactivate?'}
                      </span>
                      <Button
                        size="sm"
                        variant={leader.active ? 'destructive' : 'default'}
                        onClick={() => handleToggleActive(leader)}
                        disabled={busyUid === leader.id}
                      >
                        Yes
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmToggleUid(null)}
                        disabled={busyUid === leader.id}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmToggleUid(leader.id)}
                      disabled={busyUid !== null}
                    >
                      {leader.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {showProvisionModal && campId && (
        <ProvisionLeaderModal
          campId={campId}
          subGroups={subGroups}
          leaders={leaders}
          onProvisioned={handleProvisioned}
          onClose={() => setShowProvisionModal(false)}
        />
      )}
    </div>
  )
}
