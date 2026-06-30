import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { getAuth } from 'firebase/auth'
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/formatMoney'
import type { Participant } from '@/features/participants/types'
import { createAllocations } from '../services/allocationService'
import type { PaymentBatch, AllocationRow } from '../types'

// Re-export AllocationRow from types for convenience
export type { AllocationRow }

interface ValidRow extends AllocationRow {
  feeOwed: number
  currentPaid: number
  overpayment: number  // > 0 if amount > (feeOwed - currentPaid)
}

interface ErrorRow {
  rowNum: number
  participantId: string
  rawAmount: string
  reason: string
}

interface Preview {
  valid: ValidRow[]
  errors: ErrorRow[]
  totalNew: number
  remaining: number
  overspend: boolean
}

function uid() {
  const user = getAuth().currentUser
  return user?.email ?? user?.uid ?? 'admin'
}

interface Props {
  open: boolean
  onClose: () => void
  onAllocated: () => void
  campId: string
  batch: PaymentBatch
  /** Full participant list for this camp (from CampDataContext) */
  participants: Participant[]
  currency: string
}

export function AllocationsUploadModal({
  open,
  onClose,
  onAllocated,
  campId,
  batch,
  participants,
  currency,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [committing, setCommitting] = useState(false)

  function reset() {
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    reset()

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete({ data }) {
        parseAndValidate(data)
      },
      error(err) {
        toast.error(`CSV parse error: ${err.message}`)
      },
    })
  }

  function parseAndValidate(rows: Record<string, string>[]) {
    // Build a quick lookup from participantId → participant
    const byId = new Map(participants.map((p) => [p.id, p]))

    const valid: ValidRow[] = []
    const errors: ErrorRow[] = []

    rows.forEach((row, i) => {
      const rowNum = i + 2  // 1-based, +1 for header
      const participantId = (row['participantId'] ?? '').trim()
      const rawAmount = (row['amountPaid'] ?? '').trim()

      // Skip rows where amountPaid is blank (leader left them unfilled)
      if (!rawAmount) return

      const amount = parseFloat(rawAmount)

      if (!participantId) {
        errors.push({ rowNum, participantId: '(blank)', rawAmount, reason: 'participantId is missing' })
        return
      }
      if (isNaN(amount) || amount <= 0) {
        errors.push({ rowNum, participantId, rawAmount, reason: 'amountPaid must be a positive number' })
        return
      }

      const p = byId.get(participantId)
      if (!p) {
        errors.push({ rowNum, participantId, rawAmount, reason: 'Participant ID not found in this camp' })
        return
      }
      if (p.subGroupId !== batch.subGroupId) {
        errors.push({
          rowNum,
          participantId,
          rawAmount,
          reason: `${p.fullName} belongs to ${p.subGroupName}, not ${batch.subGroupName} — cross-sub-group allocation not allowed`,
        })
        return
      }

      const overpayment = Math.max(0, amount - (p.feeOwed - p.amountPaid))
      valid.push({
        participantId: p.id,
        participantName: p.fullName,
        amount,
        feeOwed: p.feeOwed,
        currentPaid: p.amountPaid,
        overpayment,
      })
    })

    const totalNew = valid.reduce((s, r) => s + r.amount, 0)
    const remaining = batch.amountReceived - batch.amountAllocated
    const overspend = totalNew > remaining

    setPreview({ valid, errors, totalNew, remaining, overspend })
  }

  async function handleConfirm() {
    if (!preview || preview.valid.length === 0 || preview.overspend) return

    setCommitting(true)
    try {
      const rows: AllocationRow[] = preview.valid.map((r) => ({
        participantId: r.participantId,
        participantName: r.participantName,
        amount: r.amount,
      }))
      await createAllocations(campId, batch.id, batch.referenceCode, rows, uid())
      toast.success(`Allocated ${formatMoney(preview.totalNew, currency)} across ${rows.length} participant(s)`)
      onAllocated()
      handleClose()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to allocate')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Allocations — {batch.referenceCode}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File picker */}
          <div>
            <p className="mb-2 text-sm text-muted-foreground">
              Upload the roster CSV returned by the sub-group leader. The system reads
              only <code className="font-mono text-xs">participantId</code> and{' '}
              <code className="font-mono text-xs">amountPaid</code> columns.
              Blank <code className="font-mono text-xs">amountPaid</code> rows are skipped.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="text-sm"
            />
          </div>

          {/* Preview */}
          {preview && (
            <div className="space-y-3">
              {/* Overspend block */}
              {preview.overspend && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Over-allocation blocked</p>
                    <p>
                      Upload total ({formatMoney(preview.totalNew, currency)}) exceeds remaining
                      balance ({formatMoney(preview.remaining, currency)}).
                      Reduce amounts or split across batches.
                    </p>
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border bg-card px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Rows to apply</p>
                  <p className="text-lg font-semibold">{preview.valid.length}</p>
                </div>
                <div className="rounded-md border bg-card px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Total to allocate</p>
                  <p className={`text-lg font-semibold ${preview.overspend ? 'text-destructive' : ''}`}>
                    {formatMoney(preview.totalNew, currency)}
                  </p>
                </div>
                <div className="rounded-md border bg-card px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Remaining balance</p>
                  <p className="text-lg font-semibold">{formatMoney(preview.remaining, currency)}</p>
                </div>
              </div>

              {/* Valid rows */}
              {preview.valid.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <CheckCircle className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
                    Will allocate ({preview.valid.length})
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-md border text-sm">
                    <table className="w-full">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Name</th>
                          <th className="px-3 py-1.5 text-right">Fee owed</th>
                          <th className="px-3 py-1.5 text-right">Amount</th>
                          <th className="px-3 py-1.5 text-right">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.valid.map((r) => (
                          <tr key={r.participantId} className="border-t">
                            <td className="px-3 py-1.5">{r.participantName}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {formatMoney(r.feeOwed, currency)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {formatMoney(r.amount, currency)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-xs">
                              {r.overpayment > 0 && (
                                <span className="text-amber-600">
                                  +{formatMoney(r.overpayment, currency)} over
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Error rows */}
              {preview.errors.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
                    Skipped / errors ({preview.errors.length})
                  </p>
                  <div className="max-h-32 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 text-sm">
                    {preview.errors.map((e) => (
                      <div key={`${e.rowNum}-${e.participantId}`} className="border-b border-amber-100 px-3 py-1.5 last:border-0">
                        <span className="font-mono text-xs text-muted-foreground">Row {e.rowNum}</span>
                        {' '}·{' '}
                        <span className="text-amber-800">{e.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={committing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              committing ||
              !preview ||
              preview.valid.length === 0 ||
              preview.overspend
            }
          >
            {committing
              ? 'Allocating…'
              : preview
                ? `Allocate to ${preview.valid.length} participant(s)`
                : 'Upload CSV first'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
