import { useRef, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { Camera, X } from 'lucide-react'
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
import { uploadReceiptToBatch } from '../services/receiptService'
import type { PaymentBatch, PaymentMethod } from '../types'

interface StagedFile {
  id: string
  file: File
  previewUrl: string
}

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
  const [uploadStatus, setUploadStatus] = useState('')

  // Receipts can only be staged at create time — an existing batch already
  // has its own full Receipts section (with progress/retry/lightbox) on the
  // batch detail page, so re-showing a picker here would just duplicate it.
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canEditAmount = !isEdit || existing!.amountAllocated === 0

  function uid() {
    const user = getAuth().currentUser
    return user?.email ?? user?.uid ?? 'admin'
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const next = Array.from(fileList).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setStagedFiles((prev) => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeStagedFile(id: string) {
    setStagedFiles((prev) => {
      const item = prev.find((f) => f.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
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
        const newBatchId = await createBatch(
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

        // The batch record itself is what matters — if a staged receipt
        // fails to upload, don't fail the whole save. It can be retried
        // from the batch detail page's Receipts section.
        let failCount = 0
        for (let i = 0; i < stagedFiles.length; i++) {
          setUploadStatus(`Uploading receipt ${i + 1} of ${stagedFiles.length}…`)
          try {
            await uploadReceiptToBatch(campId, newBatchId, stagedFiles[i].file, uid())
          } catch {
            failCount++
          }
        }
        setUploadStatus('')
        stagedFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl))

        if (stagedFiles.length === 0) {
          toast.success('Batch created')
        } else if (failCount === 0) {
          toast.success('Batch created with receipt(s) attached')
        } else {
          toast.error(
            `Batch created, but ${failCount} of ${stagedFiles.length} receipt(s) failed to upload — retry from the batch detail page`,
          )
        }
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

          {/* Receipts — create-time only; an existing batch manages its own
              receipts on the detail page */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Receipt(s) <span className="text-muted-foreground">(optional)</span></Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                <Camera className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                Add screenshot
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <p className="text-xs text-muted-foreground">
                Attach a screenshot of the MoMo/cash handover now, or add it later from the batch detail page.
              </p>
              {stagedFiles.length > 0 && (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {stagedFiles.map((f) => (
                    <div key={f.id} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                      <img src={f.previewUrl} alt="Receipt preview" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove staged receipt"
                        onClick={() => removeStagedFile(f.id)}
                        disabled={saving}
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (uploadStatus || 'Saving…') : isEdit ? 'Save changes' : 'Create batch'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
