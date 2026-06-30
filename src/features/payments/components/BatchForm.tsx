import { useState } from 'react'
import { getAuth } from 'firebase/auth'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { SubGroup } from '@/features/camps/types'
import { createBatch, updateBatchMetadata } from '../services/batchService'
import type { PaymentBatch, PaymentMethod } from '../types'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'MOMO', label: 'MoMo' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank Transfer' },
  { value: 'OTHER', label: 'Other' },
]

interface Props {
  campId: string
  subGroups: SubGroup[]
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** Pass to edit an existing batch; omit for create */
  existing?: PaymentBatch
}

export function BatchForm({ campId, subGroups, open, onClose, onSaved, existing }: Props) {
  const isEdit = !!existing

  const [subGroupId, setSubGroupId] = useState(existing?.subGroupId ?? '')
  const [amount, setAmount] = useState(existing ? String(existing.amountReceived) : '')
  const [method, setMethod] = useState<PaymentMethod>(existing?.method ?? 'MOMO')
  const [extRef, setExtRef] = useState(existing?.externalReference ?? '')
  const [receivedAt, setReceivedAt] = useState(
    existing
      ? existing.receivedAt.toDate().toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const canEditAmount = !isEdit || existing!.amountAllocated === 0

  function uid() {
    const user = getAuth().currentUser
    return user?.email ?? user?.uid ?? 'admin'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsedAmount = parseFloat(amount)
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!subGroupId && !isEdit) {
      toast.error('Select a sub-group')
      return
    }

    setSaving(true)
    try {
      if (isEdit) {
        const patch: Parameters<typeof updateBatchMetadata>[2] = {
          method,
          externalReference: extRef.trim() || undefined,
          receivedAt: new Date(receivedAt),
          notes: notes.trim() || undefined,
        }
        if (canEditAmount) patch.amountReceived = parsedAmount
        await updateBatchMetadata(campId, existing!.id, patch, uid())
        toast.success('Batch updated')
      } else {
        const sg = subGroups.find((s) => s.id === subGroupId)!
        await createBatch(
          campId,
          {
            subGroupId,
            subGroupName: sg.name,
            amountReceived: parsedAmount,
            method,
            externalReference: extRef.trim() || undefined,
            receivedAt: new Date(receivedAt),
            notes: notes.trim() || undefined,
          },
          uid(),
        )
        toast.success('Batch created')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to save batch')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Batch' : 'New Payment Batch'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Sub-group (locked when editing) */}
          <div className="space-y-1.5">
            <Label>Sub-group</Label>
            {isEdit ? (
              <p className="text-sm font-medium">{existing!.subGroupName}</p>
            ) : (
              <Select value={subGroupId} onValueChange={setSubGroupId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select sub-group…" />
                </SelectTrigger>
                <SelectContent>
                  {subGroups.map((sg) => (
                    <SelectItem key={sg.id} value={sg.id}>{sg.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="amount">
              Amount received
              {!canEditAmount && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (locked — allocations exist)
                </span>
              )}
            </Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!canEditAmount}
              required={!isEdit}
              placeholder="0.00"
            />
          </div>

          {/* Method */}
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* External reference */}
          <div className="space-y-1.5">
            <Label htmlFor="ext-ref">External reference <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="ext-ref"
              value={extRef}
              onChange={(e) => setExtRef(e.target.value)}
              placeholder="MoMo transaction ID, cheque number…"
            />
          </div>

          {/* Received at */}
          <div className="space-y-1.5">
            <Label htmlFor="received-at">Received on</Label>
            <Input
              id="received-at"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              required
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create batch'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
