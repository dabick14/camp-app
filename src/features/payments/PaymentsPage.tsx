import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Plus, RefreshCw } from 'lucide-react'
import { PageTitle } from '@/components/ui/page-title'
import { PageError } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SubGroupSelect } from '@/features/camps/components/SubGroupSelect'
import type { SuperGroup } from '@/features/camps/types'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { derivePaymentState } from '@/features/participants/types'
import { formatMoney } from '@/lib/formatMoney'
import { ReportButton } from '@/features/reports/components/ReportButton'
import { generatePaymentsExpectedReport } from '@/features/reports/generators'
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

// Shared between the mobile card and desktop table so the tri-state reads
// identically at both sizes.
function SubGroupStatusBadge({ status }: { status: SubGroupStatus }) {
  if (status === 'RECONCILED') {
    return (
      <Badge variant="paid" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Reconciled
      </Badge>
    )
  }
  if (status === 'UNRECONCILED') {
    return (
      <Badge variant="partial" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        Unreconciled
      </Badge>
    )
  }
  return <Badge variant="waived">No payments</Badge>
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

  const paymentsReportText = useMemo(() => generatePaymentsExpectedReport(
    camp?.name ?? 'Camp',
    currency,
    summary.map((row) => ({
      name: row.name,
      cashReceived: row.totalCashReceived,
      outstanding: row.totalExpected - row.totalConfirmed,
    })),
  ), [camp?.name, currency, summary])

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Payments</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <ReportButton label="Payments report" reportText={paymentsReportText} />
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

      {/* Summary / Batches tabs — same tab pattern as the Dashboard */}
      <Tabs defaultValue="summary">
        {/* Scrollable tab strip on mobile (2 tabs fit, but kept consistent with Dashboard) */}
        <div className="relative mb-4 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent sm:hidden" />
          <TabsList className="w-max justify-start">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="batches">Batches</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Summary tab — per-sub-group ──────────────────────────────────── */}
        <TabsContent value="summary">
        {summary.length === 0 ? (
          <p className="rounded-md border py-8 text-center text-sm text-muted-foreground">
            No sub-groups
          </p>
        ) : (
          <>
            {/* Mobile: one card per sub-group — the 10-column table is unreadable
                below sm, so surface only the figures that matter at a glance. */}
            <div className="space-y-3 sm:hidden">
              {summary.map((row) => (
                <div key={row.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {participantsPending
                          ? 'Loading…'
                          : `${row.registered} registered · ${row.paid} paid · ${row.partial} partial · ${row.pending} pending`}
                      </p>
                    </div>
                    <SubGroupStatusBadge status={row.status} />
                  </div>

                  <dl className="mt-3 space-y-1.5 border-t pt-3 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Expected</dt>
                      <dd className="tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalExpected, currency)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Cash received</dt>
                      <dd className="tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalCashReceived, currency)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Confirmed</dt>
                      <dd className="tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalConfirmed, currency)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between font-medium">
                      <dt className="text-muted-foreground">Outstanding</dt>
                      <dd className="tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalExpected - row.totalConfirmed, currency)}
                      </dd>
                    </div>
                  </dl>

                  {row.status === 'UNRECONCILED' && row.openBatch && (
                    <button
                      type="button"
                      className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-status-partial-bg px-3 text-sm font-medium text-status-partial"
                      onClick={() => navigate(`/admin/camps/${campId}/payments/${row.openBatch!.id}`)}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      View unreconciled batch
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop / tablet: table */}
            <div className="hidden overflow-x-auto rounded-md border sm:block">
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
                  {summary.map((row) => (
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
                            className="inline-flex items-center gap-1 text-status-partial hover:underline"
                            onClick={() =>
                              row.openBatch &&
                              navigate(`/admin/camps/${campId}/payments/${row.openBatch!.id}`)
                            }
                          >
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            Unreconciled
                          </button>
                        ) : row.status === 'RECONCILED' ? (
                          <span className="inline-flex items-center gap-1 text-status-paid">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            Reconciled
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No payments</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        </TabsContent>

        {/* ── Batches tab ───────────────────────────────────────────────────── */}
        <TabsContent value="batches">
        <div className="mb-3 flex justify-end">
          {/* Sub-group filter */}
          <SubGroupSelect
            subGroups={subGroups}
            superGroups={superGroups}
            value={sgFilter}
            onChange={setSgFilter}
            noneLabel="All sub-groups"
            className="w-full sm:w-48"
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
          <>
            {/* Mobile: one card per batch — the 8-column table overflows below sm */}
            <div className="space-y-3 sm:hidden">
              {filteredBatches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => navigate(`/admin/camps/${campId}/payments/${b.id}`)}
                  className="w-full rounded-lg border bg-card p-4 text-left"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-medium">{b.referenceCode}</span>
                    <BatchStatusBadge status={b.status} />
                  </div>
                  <dl className="mt-3 space-y-1.5 border-t pt-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Sub-group</dt>
                      <dd className="text-right">{b.subGroupName}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Date</dt>
                      <dd>{formatDate(b.receivedAt)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Method</dt>
                      <dd>{METHOD_LABEL[b.method] ?? b.method}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Received</dt>
                      <dd className="tabular-nums">{formatMoney(b.amountReceived, currency)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 font-medium">
                      <dt className="text-muted-foreground">Remaining</dt>
                      <dd className="tabular-nums">
                        {formatMoney(b.amountReceived - b.amountAllocated, currency)}
                      </dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>

            {/* Desktop / tablet: table */}
            <div className="hidden overflow-x-auto rounded-md border sm:block">
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
          </>
        )}
        </TabsContent>
      </Tabs>

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
