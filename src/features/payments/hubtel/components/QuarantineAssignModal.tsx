import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatMoney } from '@/lib/formatMoney'
import { auth } from '@/lib/firebase'
import type { SubGroup } from '@/features/camps/types'
import type { QuarantineItem } from '../types'
import {
  assignQuarantineToBatch,
  markQuarantineRefunded,
} from '../services/hubtelService'

interface QuarantineAssignModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: QuarantineItem | null
  campId: string
  subGroups: SubGroup[]
  currency: string
  onResolved: () => void
}

export function QuarantineAssignModal({
  open,
  onOpenChange,
  item,
  campId,
  subGroups,
  currency,
  onResolved,
}: QuarantineAssignModalProps) {
  const [subGroupId, setSubGroupId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setSubGroupId('')
      setError('')
      setBusy(false)
    }
  }, [open, item])

  if (!item) return null

  async function handleAssign() {
    if (!item) return
    if (!subGroupId) {
      setError('Select a sub-group to assign this payment to.')
      return
    }
    const sub = subGroups.find((s) => s.id === subGroupId)
    if (!sub) {
      setError('Sub-group not found.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await assignQuarantineToBatch({
        quarantineId: item.id,
        campId,
        subGroupId,
        subGroupName: sub.name,
        amount: item.amount,
        reference: item.reference,
        checkoutId: item.checkoutId ?? null,
        channel: item.channel ?? null,
        uid: auth.currentUser!.uid,
      })
      onResolved()
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message || 'Failed to assign.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRefund() {
    if (!item) return
    setBusy(true)
    setError('')
    try {
      await markQuarantineRefunded(item.id, auth.currentUser!.uid)
      onResolved()
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message || 'Failed to mark as refunded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve quarantined payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="font-mono">{item.reference}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd>{formatMoney(item.amount, currency)}</dd>
            {item.senderPhone && (
              <>
                <dt className="text-muted-foreground">Sender</dt>
                <dd>{item.senderPhone}</dd>
              </>
            )}
            {item.channel && (
              <>
                <dt className="text-muted-foreground">Channel</dt>
                <dd>{item.channel}</dd>
              </>
            )}
          </dl>

          <div className="space-y-1.5">
            <Label>Assign to sub-group</Label>
            <Select value={subGroupId} onValueChange={setSubGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a sub-group…" />
              </SelectTrigger>
              <SelectContent>
                {subGroups.map((sg) => (
                  <SelectItem key={sg.id} value={sg.id}>
                    {sg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Creates a payment batch for the selected sub-group. This cannot be undone.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRefund}
              disabled={busy}
              className="text-muted-foreground"
            >
              Mark refunded
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleAssign} disabled={busy}>
                {busy ? 'Assigning…' : 'Assign to batch'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
