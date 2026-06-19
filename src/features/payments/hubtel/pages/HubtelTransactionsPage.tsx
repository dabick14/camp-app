import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMoney } from '@/lib/formatMoney'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import type { HubtelTransaction, HubtelTransactionStatus, QuarantineItem } from '../types'
import {
  listHubtelTransactions,
  listQuarantine,
} from '../services/hubtelService'
import { HubtelCheckoutModal } from '../components/HubtelCheckoutModal'
import { QuarantineAssignModal } from '../components/QuarantineAssignModal'

const STATUS_BADGE: Record<
  HubtelTransactionStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  MATCHED: { label: 'Matched', variant: 'default' },
  PENDING: { label: 'Pending', variant: 'secondary' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  QUARANTINED: { label: 'Quarantined', variant: 'outline' },
  REFUNDED: { label: 'Refunded', variant: 'outline' },
}

function fmtTime(ts?: { toDate: () => Date }): string {
  if (!ts) return '—'
  try {
    return ts.toDate().toLocaleString()
  } catch {
    return '—'
  }
}

export function HubtelTransactionsPage() {
  const { id: campId } = useParams<{ id: string }>()
  const { subGroups, camp } = useCampData()
  const currency = camp?.currency ?? 'GHS'

  const [transactions, setTransactions] = useState<HubtelTransaction[]>([])
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [assignItem, setAssignItem] = useState<QuarantineItem | null>(null)

  const load = useCallback(async () => {
    if (!campId) return
    setLoading(true)
    setError('')
    try {
      const [txns, q] = await Promise.all([
        listHubtelTransactions(campId),
        listQuarantine(),
      ])
      setTransactions(txns)
      setQuarantine(q.filter((item) => item.status === 'QUARANTINED'))
    } catch (err) {
      setError((err as Error).message || 'Failed to load Hubtel transactions.')
    } finally {
      setLoading(false)
    }
  }, [campId])

  useEffect(() => {
    load()
  }, [load])

  if (!campId) return null

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            MoMo &amp; card payments taken in-app via Hubtel. Each confirmed payment creates
            a payment batch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => setCheckoutOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New payment
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Quarantine — orphan callbacks needing manual assignment */}
      {quarantine.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">
            ⚠️ Quarantined payments ({quarantine.length})
          </h2>
          <p className="mb-3 text-xs text-amber-800">
            Payments that arrived without a matching checkout. Assign each to a sub-group or
            mark it refunded.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Sender</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quarantine.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{fmtTime(item.receivedAt ?? item.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{item.reference}</TableCell>
                  <TableCell>{item.senderPhone ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {formatMoney(item.amount, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setAssignItem(item)}>
                      Resolve
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Main transaction history */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Sub-group</TableHead>
              <TableHead>Sender</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No Hubtel transactions yet. Start one with “New payment”.
                </TableCell>
              </TableRow>
            )}
            {transactions.map((t) => {
              const badge = STATUS_BADGE[t.status] ?? STATUS_BADGE.PENDING
              const shownAmount = t.status === 'MATCHED' ? t.amount : t.amountExpected
              return (
                <TableRow key={t.id}>
                  <TableCell>{fmtTime(t.matchedAt ?? t.createdAt)}</TableCell>
                  <TableCell>{t.subGroupName}</TableCell>
                  <TableCell>{t.senderPhone ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(shownAmount ?? 0, currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <HubtelCheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        campId={campId}
        subGroups={subGroups}
        currency={currency}
        onConfirmed={load}
      />

      <QuarantineAssignModal
        open={assignItem !== null}
        onOpenChange={(o) => !o && setAssignItem(null)}
        item={assignItem}
        campId={campId}
        subGroups={subGroups}
        currency={currency}
        onResolved={load}
      />
    </div>
  )
}
