import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { PageError, PageLoading } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { db } from '@/lib/firebase'
import { formatMoney } from '@/lib/formatMoney'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import type { Participant } from '@/features/participants/types'
import { reconcileAndConfirm, reconcileWithVariance, reopenBatch } from './services/batchService'
import type { PaymentBatch } from './types'
import { BatchStatusBadge } from './components/BatchStatusBadge'
import { BatchForm } from './components/BatchForm'
import { BatchReceipts } from './components/BatchReceipts'

const METHOD_LABEL: Record<string, string> = {
  MOMO: 'MoMo',
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  OTHER: 'Other',
}

function formatDate(ts: { toDate(): Date }) {
  return ts.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function uid() {
  const user = getAuth().currentUser
  return user?.email ?? user?.uid ?? 'admin'
}

// ── Roster CSV (legacy — leaders now use in-system claim; this remains for reference)
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

// ── Reopen confirmation dialog ────────────────────────────────────────────────
function ReopenDialog({
  campId,
  batchId,
  referenceCode,
  onReopened,
  onClose,
}: {
  campId: string
  batchId: string
  referenceCode: string
  onReopened: () => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)

  async function handleReopen() {
    if (!reason.trim()) return
    setWorking(true)
    try {
      await reopenBatch(campId, batchId, uid(), reason.trim())
      toast.success('Batch reopened')
      onReopened()
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
          <DialogTitle>Reopen batch {referenceCode}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This batch has been reconciled. Reopening resets its status to OPEN and unblocks
            new registrations for this sub-group. Confirmed participants remain confirmed.
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for reopening…"
            rows={3}
            className="text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>Cancel</Button>
          <Button variant="destructive" onClick={handleReopen} disabled={working || !reason.trim()}>
            {working ? 'Reopening…' : 'Reopen batch'}
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
  unconfirmedCount,
  subGroupName,
  currency,
  onReconciled,
  onClose,
}: {
  campId: string
  batchId: string
  remaining: number
  unconfirmedCount: number
  subGroupName: string
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

  const diffLabel = remaining > 0
    ? `${formatMoney(remaining, currency)} short`
    : `${formatMoney(-remaining, currency)} over`

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reconcile with variance</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The claimed participants owe a total that is{' '}
            <span className="font-medium text-amber-700">{diffLabel}</span> of the received lump.
            {unconfirmedCount > 0 && (
              <>
                {' '}The {unconfirmedCount} claimed participant{unconfirmedCount !== 1 ? 's' : ''} in{' '}
                <span className="font-medium">{subGroupName}</span> will{' '}
                <strong>not</strong> be confirmed as PAID and will remain unroomable.
                Use the per-person override if you need to room someone before this is resolved.
              </>
            )}
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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [working, setWorking] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showReopen, setShowReopen] = useState(false)
  const [showVariance, setShowVariance] = useState(false)

  const loadBatch = useCallback(async () => {
    if (!campId || !batchId) return
    setLoading(true)
    setLoadError('')
    try {
      const snap = await getDoc(doc(db, 'camps', campId, 'paymentBatches', batchId))
      if (!snap.exists()) {
        toast.error('Batch not found')
        navigate(`/admin/camps/${campId}/payments`)
        return
      }
      setBatch({ id: snap.id, ...snap.data() } as PaymentBatch)
    } catch (err) {
      setLoadError((err as Error).message ?? 'Failed to load batch')
    } finally {
      setLoading(false)
    }
  }, [campId, batchId, navigate])

  useEffect(() => { loadBatch() }, [loadBatch])

  if (loading) return <PageContainer><PageLoading /></PageContainer>
  if (loadError) return (
    <PageContainer>
      <PageError message={loadError} onRetry={loadBatch} />
    </PageContainer>
  )
  if (!batch) return null

  const sgParticipants = participants.filter((p) => p.subGroupId === batch.subGroupId)

  // Claimed-but-unconfirmed: leader has asserted payment but admin hasn't confirmed yet
  const claimedUnconfirmed = sgParticipants.filter(
    (p) =>
      p.registrationState === 'REGISTERED' &&
      p.paymentClaimed === true &&
      !p.confirmedBatchId,
  )
  const claimedSum = claimedUnconfirmed.reduce((s, p) => s + p.feeOwed, 0)
  const matches = claimedUnconfirmed.length > 0 && claimedSum === batch.amountReceived
  const diff = batch.amountReceived - claimedSum  // positive = we received more than claimed; negative = short

  // Participants THIS batch confirmed — kept visible independent of the batch's
  // current status so a reopened/reconciled batch never reads as if it did nothing.
  const confirmedByBatch = participants
    .filter((p) => p.confirmedBatchId === batch.id)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
  const confirmedTotal = confirmedByBatch.reduce((s, p) => s + p.feeOwed, 0)

  const isReconciled = batch.status === 'RECONCILED'
  // On the variance path amountAllocated stays 0, so this is the whole
  // received sum — the part of this batch never matched to individuals.
  const unallocated = batch.amountReceived - batch.amountAllocated

  async function handleReconcileAndConfirm() {
    if (!campId || !batchId) return
    setWorking(true)
    try {
      await reconcileAndConfirm(campId, batchId, claimedUnconfirmed.map((p) => p.id), uid())
      toast.success(`${claimedUnconfirmed.length} participant${claimedUnconfirmed.length !== 1 ? 's' : ''} confirmed as PAID`)
      await loadBatch()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
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
          {batch.varianceNote && (
            <p className="mt-0.5 text-sm text-amber-700">
              Variance note: {batch.varianceNote}
            </p>
          )}
        </div>

        {/* Actions — full-width stacked buttons on mobile, inline row on desktop */}
        <div className="flex flex-col gap-2 sm:shrink-0 sm:items-end">
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Button
              variant="outline"
              size="sm"
              className="h-11 w-full whitespace-normal sm:h-7 sm:w-auto sm:whitespace-nowrap"
              onClick={() => downloadRosterCsv(sgParticipants, batch.subGroupName, batch.referenceCode)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5 shrink-0" />
              Download roster
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 w-full whitespace-normal sm:h-7 sm:w-auto sm:whitespace-nowrap"
              onClick={() => setShowEdit(true)}
            >
              Edit
            </Button>
            {batch.status === 'OPEN' ? (
              <>
                <Button
                  size="sm"
                  className="h-11 w-full whitespace-normal sm:h-7 sm:w-auto sm:whitespace-nowrap"
                  onClick={handleReconcileAndConfirm}
                  disabled={working || !matches}
                >
                  Reconcile &amp; Confirm
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 w-full whitespace-normal sm:h-7 sm:w-auto sm:whitespace-nowrap"
                  onClick={() => setShowVariance(true)}
                  disabled={working}
                >
                  Reconcile with variance
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-11 w-full whitespace-normal sm:h-7 sm:w-auto sm:whitespace-nowrap"
                onClick={() => setShowReopen(true)}
                disabled={working}
              >
                Reopen
              </Button>
            )}
          </div>
          {batch.status === 'OPEN' && !matches && (
            <p className="text-xs text-amber-700">
              {diff > 0
                ? `Over by ${formatMoney(diff, currency)} — claimed ${formatMoney(claimedSum, currency)}, received ${formatMoney(batch.amountReceived, currency)}`
                : claimedUnconfirmed.length === 0
                  ? 'No participants have been claimed yet'
                  : `Short by ${formatMoney(-diff, currency)} — claimed ${formatMoney(claimedSum, currency)}, received ${formatMoney(batch.amountReceived, currency)}`}
            </p>
          )}
        </div>
      </div>

      {/* Amount breakdown — stacked on mobile so each card has room for its
          number + label + sub-note (a 3-across row truncates at 390px) */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-lg border bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">Received</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(batch.amountReceived, currency)}</p>
        </div>
        <div className="rounded-lg border bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">Awaiting confirmation</p>
          {isReconciled && claimedUnconfirmed.length === 0 ? (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">✓ All confirmed</p>
              <p className="mt-0.5 text-xs text-muted-foreground">No participants awaiting confirmation</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(claimedSum, currency)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {claimedUnconfirmed.length} unconfirmed participant{claimedUnconfirmed.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>
        {isReconciled && !batch.varianceAcknowledged ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-5 py-4">
            <p className="text-sm text-muted-foreground">Confirmed</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
              ✓ {formatMoney(batch.amountAllocated, currency)}
            </p>
            <p className="mt-0.5 text-xs text-emerald-600">Match — reconciled</p>
          </div>
        ) : isReconciled && batch.varianceAcknowledged ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
            <p className="text-sm text-muted-foreground">Variance</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">
              {formatMoney(unallocated, currency)}
            </p>
            <p className="mt-0.5 text-xs text-amber-600">Reconciled with variance · not allocated to individuals</p>
          </div>
        ) : (
          <div className={`rounded-lg border px-5 py-4 ${!matches ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
            <p className="text-sm text-muted-foreground">Difference</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${!matches ? 'text-amber-700' : 'text-emerald-700'}`}>
              {matches ? '✓ Match' : diff > 0 ? `+${formatMoney(diff, currency)}` : formatMoney(diff, currency)}
            </p>
            <p className="mt-0.5 text-xs">
              {matches
                ? <span className="text-emerald-600">Ready to confirm</span>
                : diff > 0
                  ? <span className="text-amber-600">Over by {formatMoney(diff, currency)}</span>
                  : <span className="text-amber-600">Short by {formatMoney(-diff, currency)} · blocks registration</span>
              }
            </p>
          </div>
        )}
      </div>

      {/* Reconciliation panel — claimed-but-unconfirmed participants */}
      {(claimedUnconfirmed.length > 0 || batch.status === 'OPEN' || confirmedByBatch.length > 0) && (
        <>
          <Separator />
          <section className="mt-8">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Claimed — awaiting confirmation
            </h3>
            {claimedUnconfirmed.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {confirmedByBatch.length > 0
                  ? 'All claimed participants have been confirmed.'
                  : 'No participants have been claimed by the coordinator yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Fee owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claimedUnconfirmed.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-4 py-2.5">{p.fullName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(p.feeOwed, currency)}</td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/30 font-medium">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(claimedSum, currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Confirmed-by-this-batch panel — the permanent record of who this batch
          confirmed. Visible regardless of the batch's current status so a
          reopened batch never reads as if it confirmed no one. */}
      {confirmedByBatch.length > 0 && (
        <>
          <Separator />
          <section className="mt-8">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Confirmed by this batch ({confirmedByBatch.length})
              </h3>
              <p className="text-sm tabular-nums text-muted-foreground">
                Total {formatMoney(confirmedTotal, currency)}
              </p>
            </div>

            {/* Mobile: stacked cards (sub-group names run long and don't fit a table) */}
            <div className="space-y-2 sm:hidden">
              {confirmedByBatch.map((p) => (
                <div key={p.id} className="rounded-md border bg-card px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{p.fullName}</p>
                    <p className="shrink-0 tabular-nums">{formatMoney(p.feeOwed, currency)}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{p.subGroupName}</p>
                </div>
              ))}
            </div>

            {/* Desktop / tablet: table */}
            <div className="hidden overflow-x-auto rounded-md border sm:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Sub-group</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Fee owed</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedByBatch.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-4 py-2.5">{p.fullName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.subGroupName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(p.feeOwed, currency)}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/30 font-medium">
                    <td className="px-4 py-2.5" colSpan={2}>Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(confirmedTotal, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <BatchReceipts
        campId={campId!}
        batchId={batchId!}
        receipts={batch.receiptImageUrls ?? []}
        uid={uid()}
        onChange={loadBatch}
      />

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
      {showReopen && (
        <ReopenDialog
          campId={campId!}
          batchId={batchId!}
          referenceCode={batch.referenceCode}
          onReopened={loadBatch}
          onClose={() => setShowReopen(false)}
        />
      )}
      {showVariance && (
        <VarianceDialog
          campId={campId!}
          batchId={batchId!}
          remaining={diff}
          unconfirmedCount={claimedUnconfirmed.length}
          subGroupName={batch.subGroupName}
          currency={currency}
          onReconciled={loadBatch}
          onClose={() => setShowVariance(false)}
        />
      )}
    </PageContainer>
  )
}
