import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { ChevronLeft, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { db } from '@/lib/firebase'
import { formatMoney } from '@/lib/formatMoney'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import type { Participant } from '@/features/participants/types'
import { markReconciled, reconcileWithVariance, reopenBatch } from './services/batchService'
import { listAllocationsByBatch, voidAllocation } from './services/allocationService'
import type { Allocation, PaymentBatch } from './types'
import { BatchStatusBadge } from './components/BatchStatusBadge'
import { BatchForm } from './components/BatchForm'
import { AllocationsUploadModal } from './components/AllocationsUploadModal'

const METHOD_LABEL: Record<string, string> = {
  MOMO: 'MoMo',
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  OTHER: 'Other',
}

function formatDate(ts: { toDate(): Date }) {
  return ts.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTs(ts: { toDate(): Date } | undefined) {
  if (!ts) return '—'
  return ts.toDate().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function uid() {
  const user = getAuth().currentUser
  return user?.email ?? user?.uid ?? 'admin'
}

// ── Part C: roster CSV ────────────────────────────────────────────────────────
function downloadRosterCsv(participants: Participant[], subGroupName: string, referenceCode: string) {
  const rows: string[][] = [
    ['participantId', 'fullName', 'phone', 'roomTypePreference', 'feeOwed', 'amountPaid'],
  ]
  for (const p of participants) {
    if (p.registrationState !== 'REGISTERED') continue
    rows.push([p.id, p.fullName, p.phone, p.roomTypePreferenceName, String(p.feeOwed), ''])
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${referenceCode}-roster-${subGroupName.replace(/[^a-zA-Z0-9]/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Void confirmation dialog ──────────────────────────────────────────────────
function VoidDialog({
  allocation,
  campId,
  currency,
  onVoided,
  onClose,
}: {
  allocation: Allocation
  campId: string
  currency: string
  onVoided: () => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)

  async function handleVoid() {
    if (!reason.trim()) return
    setWorking(true)
    try {
      await voidAllocation(campId, allocation.id, reason, uid())
      toast.success(`Allocation of ${formatMoney(allocation.amount, currency)} voided`)
      onVoided()
      onClose()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to void allocation')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Void allocation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Void {formatMoney(allocation.amount, currency)} for{' '}
            <span className="font-medium">{allocation.participantName}</span>?
            This decrements their amountPaid and the batch total.
            {' '}If the batch was reconciled it will reopen.
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for voiding…"
            rows={3}
            className="text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>Cancel</Button>
          <Button variant="destructive" onClick={handleVoid} disabled={working || !reason.trim()}>
            {working ? 'Voiding…' : 'Void allocation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Reconcile with Variance dialog ────────────────────────────────────────────
function VarianceDialog({
  campId,
  batchId,
  remaining,
  currency,
  onReconciled,
  onClose,
}: {
  campId: string
  batchId: string
  remaining: number
  currency: string
  onReconciled: () => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [working, setWorking] = useState(false)

  async function handleSubmit() {
    if (!note.trim()) return
    setWorking(true)
    try {
      await reconcileWithVariance(campId, batchId, note, uid())
      toast.success('Batch reconciled with variance acknowledged')
      onReconciled()
      onClose()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reconcile with variance</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            There is an unallocated balance of{' '}
            <span className="font-medium">{formatMoney(remaining, currency)}</span>.
            Reconciling acknowledges this discrepancy. Provide a note.
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="E.g. ₵200 kept as contingency, approved by treasurer…"
            rows={3}
            className="text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={working || !note.trim()}>
            {working ? 'Reconciling…' : 'Reconcile with variance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function BatchDetailPage() {
  const { id: campId, batchId } = useParams<{ id: string; batchId: string }>()
  const navigate = useNavigate()
  const { camp, participants, subGroups } = useCampData()
  const currency = camp?.currency ?? 'GHS'

  const [batch, setBatch] = useState<PaymentBatch | null>(null)
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showVariance, setShowVariance] = useState(false)
  const [voidTarget, setVoidTarget] = useState<Allocation | null>(null)

  const loadBatch = useCallback(async () => {
    if (!campId || !batchId) return
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'camps', campId, 'paymentBatches', batchId))
      if (!snap.exists()) {
        toast.error('Batch not found')
        navigate(`/admin/camps/${campId}/payments`)
        return
      }
      setBatch({ id: snap.id, ...snap.data() } as PaymentBatch)
      const allocs = await listAllocationsByBatch(campId, batchId)
      allocs.sort((a, b) => a.createdAt?.toMillis?.() - b.createdAt?.toMillis?.() || 0)
      setAllocations(allocs)
    } catch {
      toast.error('Failed to load batch')
    } finally {
      setLoading(false)
    }
  }, [campId, batchId, navigate])

  useEffect(() => { loadBatch() }, [loadBatch])

  if (loading) return <div className="px-6 py-6 text-sm text-muted-foreground">Loading…</div>
  if (!batch) return null

  const remaining = batch.amountReceived - batch.amountAllocated
  const hasVariance = remaining !== 0
  const sgParticipants = participants.filter((p) => p.subGroupId === batch.subGroupId)
  const activeAllocations = allocations.filter((a) => !a.voided)

  async function handleMarkReconciled() {
    if (!campId || !batchId) return
    setWorking(true)
    try {
      await markReconciled(campId, batchId, uid())
      toast.success('Batch marked as reconciled')
      await loadBatch()
    } catch (err) { toast.error((err as Error).message ?? 'Failed') }
    finally { setWorking(false) }
  }

  async function handleReopen() {
    if (!campId || !batchId) return
    setWorking(true)
    try {
      await reopenBatch(campId, batchId, uid())
      toast.success('Batch reopened')
      await loadBatch()
    } catch (err) { toast.error((err as Error).message ?? 'Failed') }
    finally { setWorking(false) }
  }

  return (
    <div className="px-6 py-6">
      <Link
        to={`/admin/camps/${campId}/payments`}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" />
        Back to payments
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-xl font-semibold">{batch.referenceCode}</h2>
            <BatchStatusBadge status={batch.status} />
            {batch.varianceAcknowledged && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                Variance acknowledged
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {batch.subGroupName} · {METHOD_LABEL[batch.method] ?? batch.method} · received {formatDate(batch.receivedAt)}
          </p>
          {batch.externalReference && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Ref: <span className="font-mono">{batch.externalReference}</span>
            </p>
          )}
          {batch.notes && <p className="mt-0.5 text-sm text-muted-foreground">Note: {batch.notes}</p>}
          {(batch as any).varianceNote && (
            <p className="mt-0.5 text-sm text-amber-700">
              Variance note: {(batch as any).varianceNote}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadRosterCsv(sgParticipants, batch.subGroupName, batch.referenceCode)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download roster
          </Button>
          {batch.status === 'OPEN' && (
            <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
              Upload allocations
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
            Edit
          </Button>
          {batch.status === 'OPEN' ? (
            <>
              {!hasVariance ? (
                <Button size="sm" onClick={handleMarkReconciled} disabled={working}>
                  Mark reconciled
                </Button>
              ) : (
                <Button size="sm" onClick={() => setShowVariance(true)} disabled={working}>
                  Reconcile with variance
                </Button>
              )}
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={handleReopen} disabled={working}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* Amount breakdown */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">Received</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(batch.amountReceived, currency)}</p>
        </div>
        <div className="rounded-lg border bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">Allocated</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(batch.amountAllocated, currency)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {activeAllocations.length} active allocation{activeAllocations.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className={`rounded-lg border px-5 py-4 ${remaining > 0 && batch.status === 'OPEN' ? 'border-amber-300 bg-amber-50' : 'bg-card'}`}>
          <p className="text-sm text-muted-foreground">Remaining</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${remaining > 0 && batch.status === 'OPEN' ? 'text-amber-700' : ''}`}>
            {formatMoney(remaining, currency)}
          </p>
          {remaining > 0 && batch.status === 'OPEN' && (
            <p className="mt-0.5 text-xs text-amber-600">Blocks registration for {batch.subGroupName}</p>
          )}
        </div>
      </div>

      <Separator />

      {/* Allocations */}
      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Allocations
        </h3>

        {allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No allocations yet. Upload the returned roster CSV to allocate.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Participant</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Allocated at</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">By</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id} className={`border-t ${a.voided ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5">{a.participantName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatMoney(a.amount, currency)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatTs(a.createdAt)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[140px]">{a.createdBy}</td>
                    <td className="px-4 py-2.5">
                      {a.voided ? (
                        <span className="text-xs text-muted-foreground">
                          Voided{a.voidReason ? ` — ${a.voidReason}` : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-emerald-600 font-medium">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!a.voided && (
                        <button
                          type="button"
                          onClick={() => setVoidTarget(a)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modals */}
      {showEdit && (
        <BatchForm
          campId={campId!}
          subGroups={subGroups}
          open={showEdit}
          onClose={() => setShowEdit(false)}
          onSaved={loadBatch}
          existing={batch}
        />
      )}
      {showUpload && (
        <AllocationsUploadModal
          open={showUpload}
          onClose={() => setShowUpload(false)}
          onAllocated={loadBatch}
          campId={campId!}
          batch={batch}
          participants={participants}
          currency={currency}
        />
      )}
      {showVariance && (
        <VarianceDialog
          campId={campId!}
          batchId={batchId!}
          remaining={remaining}
          currency={currency}
          onReconciled={loadBatch}
          onClose={() => setShowVariance(false)}
        />
      )}
      {voidTarget && (
        <VoidDialog
          allocation={voidTarget}
          campId={campId!}
          currency={currency}
          onVoided={loadBatch}
          onClose={() => setVoidTarget(null)}
        />
      )}
    </div>
  )
}
