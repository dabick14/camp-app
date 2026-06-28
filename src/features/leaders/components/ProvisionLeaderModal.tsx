import { useState } from 'react'
import { getAuth } from 'firebase/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SubGroup } from '@/features/camps/types'
import type { Leader } from '../types'

const PROVISION_LEADER_URL =
  'https://us-central1-camp-app-119bb.cloudfunctions.net/provisionLeader'

export function ProvisionLeaderModal({
  campId,
  subGroups,
  leaders,
  onProvisioned,
  onClose,
}: {
  campId: string
  subGroups: SubGroup[]
  leaders: Leader[]
  onProvisioned: (subGroupName: string, email: string) => void
  onClose: () => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [subGroupId, setSubGroupId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Exclude sub-groups that already have an active leader — UX only, the
  // Cloud Function re-checks this server-side before writing.
  const takenSubGroupIds = new Set(leaders.filter((l) => l.active).map((l) => l.subGroupId))
  const availableSubGroups = subGroups.filter((sg) => !takenSubGroupIds.has(sg.id))

  function validate(): string | null {
    if (!email.trim()) return 'Email is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address'
    if (!subGroupId) return 'Please select a sub-group'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setError('')

    const idToken = await getAuth().currentUser?.getIdToken()
    if (!idToken) {
      setError('Not authenticated. Please refresh and try again.')
      return
    }

    setSaving(true)
    try {
      const subGroup = subGroups.find((sg) => sg.id === subGroupId)
      const res = await fetch(PROVISION_LEADER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          campId,
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          subGroupId,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Failed to provision leader.')
        return
      }

      onProvisioned(subGroup?.name ?? data.subGroupName, data.email)
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-w-md" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Add leader</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="leader-name">Display name (optional)</Label>
            <Input
              id="leader-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Kwame Asante"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="leader-email">Email</Label>
            <Input
              id="leader-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. kwame@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Sub-group</Label>
            <Select value={subGroupId} onValueChange={setSubGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a sub-group…" />
              </SelectTrigger>
              <SelectContent>
                {availableSubGroups.map((sg) => (
                  <SelectItem key={sg.id} value={sg.id}>
                    {sg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableSubGroups.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Every sub-group already has an active leader.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || availableSubGroups.length === 0}>
              {saving ? 'Adding…' : 'Add leader'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
