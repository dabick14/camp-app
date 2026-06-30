import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { derivePaymentState } from '@/features/participants/types'
import { formatMoney } from '@/lib/formatMoney'
import { listBatches } from './services/batchService'
import { hasUnreconciledBatch } from './types'
import type { PaymentBatch } from './types'
import { BatchStatusBadge } from './components/BatchStatusBadge'
import { BatchForm } from './components/BatchForm'

function formatDate(ts: { toDate(): Date }) {
  return ts.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
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
  const { camp, subGroups, participants } = useCampData()
  const currency = camp?.currency ?? 'GHS'

  const [batches, setBatches] = useState<PaymentBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [sgFilter, setSgFilter] = useState<string>('all')

  const loadBatches = useCallback(async () => {
    if (!campId) return
    setBatchesLoading(true)
    try {
      const result = await listBatches(campId)
      // Sort newest-first by createdAt
      result.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
      setBatches(result)
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
      let totalExpected = 0, totalReceived = 0
      for (const p of sgParticipants) {
        const ps = derivePaymentState(p)
        if (ps === 'PAID') paid++
        else if (ps === 'PARTIAL') partial++
        else if (ps === 'PENDING') pending++
        else if (ps === 'WAIVED') waived++
        totalExpected += p.feeOwed
        totalReceived += p.amountPaid
      }
      const sgBatches = batches.filter((b) => b.subGroupId === sg.id)
      const unreconciled = hasUnreconciledBatch(sgBatches)
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
        totalReceived,
        unreconciled,
        openBatch,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [subGroups, participants, batches])

  // ── Part B: filtered batch list ───────────────────────────────────────────
  const filteredBatches = useMemo(() => {
    if (sgFilter === 'all') return batches
    return batches.filter((b) => b.subGroupId === sgFilter)
  }, [batches, sgFilter])

  return (
    <div className="px-6 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payments</h2>
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
                <TableHead className="text-right">Received ({currency})</TableHead>
                <TableHead className="text-right">Outstanding ({currency})</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No sub-groups
                  </TableCell>
                </TableRow>
              ) : (
                summary.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.registered}</TableCell>
                    <TableCell className="text-right text-emerald-600">{row.paid}</TableCell>
                    <TableCell className="text-right text-amber-600">{row.partial}</TableCell>
                    <TableCell className="text-right text-red-600">{row.pending}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totalExpected, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totalReceived, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totalExpected - row.totalReceived, currency)}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.unreconciled ? (
                        <button
                          className="text-amber-600 hover:underline"
                          onClick={() =>
                            row.openBatch &&
                            navigate(`/admin/camps/${campId}/payments/${row.openBatch!.id}`)
                          }
                          title="Has OPEN batch with unallocated balance"
                        >
                          ⚠️ Unreconciled
                        </button>
                      ) : (
                        <span className="text-emerald-600">✅ Reconciled</span>
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
          <select
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
            value={sgFilter}
            onChange={(e) => setSgFilter(e.target.value)}
          >
            <option value="all">All sub-groups</option>
            {subGroups.map((sg) => (
              <option key={sg.id} value={sg.id}>{sg.name}</option>
            ))}
          </select>
        </div>

        {batchesLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading batches…</p>
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
    </div>
  )
}
