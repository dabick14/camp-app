import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Plus, RefreshCw } from 'lucide-react'
import { PageTitle } from '@/components/ui/page-title'
import { PageError } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { SubGroupSelect } from '@/features/camps/components/SubGroupSelect'
import type { SuperGroup } from '@/features/camps/types'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { derivePaymentState } from '@/features/participants/types'
import { formatMoney } from '@/lib/formatMoney'
import { listBatches } from './services/batchService'
import { hasUnreconciledBatch } from './types'
import type { PaymentBatch } from './types'

type SubGroupStatus = 'NO_PAYMENTS' | 'UNRECONCILED' | 'RECONCILED'
import { BatchStatusBadge } from './components/BatchStatusBadge'
import { BatchForm } from './components/BatchForm'

function formatDate(ts: { toDate(): Date }) {
  return ts.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Sk() {
  return <span className="inline-block h-4 w-8 animate-pulse rounded bg-muted align-middle" />
}
function SkWide() {
  return <span className="inline-block h-4 w-20 animate-pulse rounded bg-muted align-middle" />
}

const METHOD_LABEL: Record<string, string> = {
  MOMO: 'MoMo',
  CASH: 'Cash',
  BANK: 'Bank',
  OTHER: 'Other',
}

export function PaymentsPage() {
  const { id: campId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { camp, subGroups, participants, participantsLoading } = useCampData()
  const participantsPending = participantsLoading && participants.length === 0
  const superGroups: SuperGroup[] = camp?.superGroups ?? []
  const currency = camp?.currency ?? 'GHS'

  const [batches, setBatches] = useState<PaymentBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [batchesError, setBatchesError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [sgFilter, setSgFilter] = useState<string>('')

  const loadBatches = useCallback(async () => {
    if (!campId) return
    setBatchesLoading(true)
    setBatchesError('')
    try {
      const result = await listBatches(campId)
      result.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
      setBatches(result)
    } catch (err) {
      setBatchesError((err as Error).message ?? 'Failed to load batches')
    } finally {
      setBatchesLoading(false)
    }
  }, [campId])

  useEffect(() => { loadBatches() }, [loadBatches])

  // ── Part A: per-sub-group summary ──────────────────────────────────────────
  const summary = useMemo(() => {
    return subGroups.map((sg) => {
      const sgParticipants = participants.filter(
        (p) => p.subGroupId === sg.id && p.registrationState === 'REGISTERED',
      )
      let paid = 0, partial = 0, pending = 0, waived = 0
      let totalExpected = 0, totalConfirmed = 0
      for (const p of sgParticipants) {
        const ps = derivePaymentState(p)
        if (ps === 'PAID') paid++
        else if (ps === 'PARTIAL') partial++
        else if (ps === 'PENDING') pending++
        else if (ps === 'WAIVED') waived++
        totalExpected += p.feeOwed
        totalConfirmed += p.amountPaid
      }
      const sgBatches = batches.filter((b) => b.subGroupId === sg.id)
      // Physical cash actually received from the sub-group, regardless of
      // whether it's been matched to individual participants yet.
      const totalCashReceived = sgBatches.reduce((s, b) => s + b.amountReceived, 0)
      const unreconciled = hasUnreconciledBatch(sgBatches)
      const status: SubGroupStatus =
        sgBatches.length === 0 ? 'NO_PAYMENTS' : unreconciled ? 'UNRECONCILED' : 'RECONCILED'
      // Find the OPEN batch with unallocated balance for the warning link
      const openBatch = unreconciled
        ? sgBatches.find((b) => b.status === 'OPEN' && b.amountReceived - b.amountAllocated > 0)
        : null

      return {
        id: sg.id,
        name: sg.name,
        registered: sgParticipants.length,
        paid,
        partial,
        pending,
        waived,
        totalExpected,
        totalCashReceived,
        totalConfirmed,
        status,
        openBatch,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [subGroups, participants, batches])

  // ── Part B: filtered batch list ───────────────────────────────────────────
  const filteredBatches = useMemo(() => {
    if (!sgFilter) return batches
    return batches.filter((b) => b.subGroupId === sgFilter)
  }, [batches, sgFilter])

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <PageTitle>Payments</PageTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadBatches}
            disabled={batchesLoading}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${batchesLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New batch
          </Button>
        </div>
      </div>

      {/* Part A — Per-sub-group summary */}
      <section className="mb-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sub-group summary
        </h3>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sub-group</TableHead>
                <TableHead className="text-right">Registered</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Partial</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Expected ({currency})</TableHead>
                <TableHead className="text-right">Cash received ({currency})</TableHead>
                <TableHead className="text-right">Confirmed ({currency})</TableHead>
                <TableHead className="text-right">Outstanding ({currency})</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    No sub-groups
                  </TableCell>
                </TableRow>
              ) : (
                summary.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{participantsPending ? <Sk /> : row.registered}</TableCell>
                    <TableCell className="text-right text-status-paid">{participantsPending ? <Sk /> : row.paid}</TableCell>
                    <TableCell className="text-right text-status-partial">{participantsPending ? <Sk /> : row.partial}</TableCell>
                    <TableCell className="text-right text-status-pending">{participantsPending ? <Sk /> : row.pending}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {participantsPending ? <SkWide /> : formatMoney(row.totalExpected, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {participantsPending ? <SkWide /> : formatMoney(row.totalCashReceived, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {participantsPending ? <SkWide /> : formatMoney(row.totalConfirmed, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {participantsPending ? <SkWide /> : formatMoney(row.totalExpected - row.totalConfirmed, currency)}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.status === 'UNRECONCILED' ? (
                        <button
                          className="inline-flex items-center gap-1 text-amber-600 hover:underline"
                          onClick={() =>
                            row.openBatch &&
                            navigate(`/admin/camps/${campId}/payments/${row.openBatch!.id}`)
                          }
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Unreconciled
                        </button>
                      ) : row.status === 'RECONCILED' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          Reconciled
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No payments</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Part B — Batch list */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Batches
          </h3>
          {/* Sub-group filter */}
          <SubGroupSelect
            subGroups={subGroups}
            superGroups={superGroups}
            value={sgFilter}
            onChange={setSgFilter}
            noneLabel="All sub-groups"
            className="w-48"
          />
        </div>

        {batchesLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading batches…</p>
        ) : batchesError ? (
          <PageError message={batchesError} onRetry={loadBatches} />
        ) : filteredBatches.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {batches.length === 0 ? 'No batches yet.' : 'No batches for this sub-group.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref code</TableHead>
                  <TableHead>Sub-group</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Received ({currency})</TableHead>
                  <TableHead className="text-right">Allocated ({currency})</TableHead>
                  <TableHead className="text-right">Remaining ({currency})</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBatches.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => navigate(`/admin/camps/${campId}/payments/${b.id}`)}
                  >
                    <TableCell className="font-mono text-sm font-medium">
                      {b.referenceCode}
                    </TableCell>
                    <TableCell>{b.subGroupName}</TableCell>
                    <TableCell>{formatDate(b.receivedAt)}</TableCell>
                    <TableCell>{METHOD_LABEL[b.method] ?? b.method}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(b.amountReceived, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(b.amountAllocated, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(b.amountReceived - b.amountAllocated, currency)}
                    </TableCell>
                    <TableCell>
                      <BatchStatusBadge status={b.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Create batch modal */}
      {showCreate && (
        <BatchForm
          campId={campId!}
          subGroups={subGroups}
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onSaved={loadBatches}
        />
      )}
    </PageContainer>
  )
}
