import { X } from 'lucide-react'
import type { Timestamp } from 'firebase/firestore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { type Participant, type PaymentState, derivePaymentState } from './types'

function fmtDate(ts: Timestamp | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtTs(ts: Timestamp | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function PaymentBadge({ state }: { state: PaymentState }) {
  const styles: Record<PaymentState, string> = {
    PAID: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    PARTIAL: 'bg-amber-50 text-amber-700 border border-amber-200',
    PENDING: 'bg-red-50 text-red-700 border border-red-200',
    WAIVED: 'bg-muted text-muted-foreground border border-border',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[state]}`}>
      {state}
    </span>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value ?? '—'}</span>
    </div>
  )
}

export function ParticipantDrawer({
  participant,
  currency,
  onClose,
}: {
  participant: Participant | null
  currency: string
  onClose: () => void
}) {
  const open = participant !== null
  const p = participant

  const paymentState = p ? derivePaymentState(p) : null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l bg-background shadow-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {!p ? null : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold leading-tight">{p.fullName}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {p.phone} · {p.gender === 'M' ? 'Male' : 'Female'}
                  {p.age != null && ` · Age ${p.age}`}
                  {p.dateOfBirth && !p.age && ` · DOB ${fmtDate(p.dateOfBirth)}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 h-8 w-8 shrink-0 p-0"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap gap-2 border-b px-6 py-3">
              <Badge
                variant={p.registrationState === 'REGISTERED' ? 'default' : 'destructive'}
              >
                {p.registrationState}
              </Badge>
              {paymentState && <PaymentBadge state={paymentState} />}
              <Badge
                variant={p.checkInState === 'ARRIVED' ? 'default' : 'secondary'}
              >
                {p.checkInState === 'ARRIVED' ? 'Checked in' : 'Not arrived'}
              </Badge>
              {p.roomNumber && (
                <Badge variant="outline">Room {p.roomNumber}</Badge>
              )}
            </div>

            {/* Content — scrollable */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">

              {/* Grouping & room preference */}
              <section className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Registration
                </p>
                <Row label="Sub-group" value={p.subGroupName} />
                <Row label="Room type preference" value={p.roomTypePreferenceName} />
                {p.email && <Row label="Email" value={p.email} />}
              </section>

              <Separator />

              {/* Payment */}
              <section className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment
                </p>
                <Row
                  label="Fee owed"
                  value={`${currency} ${p.feeOwed.toLocaleString()}`}
                />
                <Row
                  label="Amount paid"
                  value={`${currency} ${p.amountPaid.toLocaleString()}`}
                />
                {p.feeOwed > 0 && p.amountPaid < p.feeOwed && (
                  <Row
                    label="Balance due"
                    value={
                      <span className="font-medium text-destructive">
                        {currency} {(p.feeOwed - p.amountPaid).toLocaleString()}
                      </span>
                    }
                  />
                )}
                {p.feeOwed > 0 && p.amountPaid > p.feeOwed && (
                  <Row
                    label="Credit"
                    value={
                      <span className="font-medium text-emerald-600">
                        {currency} {(p.amountPaid - p.feeOwed).toLocaleString()}
                      </span>
                    }
                  />
                )}
              </section>

              {/* Room assignment */}
              {(p.roomId || p.checkInState === 'ARRIVED') && (
                <>
                  <Separator />
                  <section className="space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Check-in / Room
                    </p>
                    <Row label="Room" value={p.roomNumber ? `Room ${p.roomNumber}` : 'Checked in (no room)'} />
                    {p.checkedInAt && <Row label="Checked in at" value={fmtTs(p.checkedInAt)} />}
                    {p.checkedInBy && <Row label="Checked in by" value={p.checkedInBy} />}
                    {p.roomAssignedAt && <Row label="Room assigned at" value={fmtTs(p.roomAssignedAt)} />}
                    {p.roomAssignedBy && <Row label="Room assigned by" value={p.roomAssignedBy} />}
                  </section>
                </>
              )}

              {/* Notes */}
              {p.notes && (
                <>
                  <Separator />
                  <section className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Notes
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{p.notes}</p>
                  </section>
                </>
              )}

              {/* Audit */}
              <Separator />
              <section className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Audit
                </p>
                <Row label="Registered at" value={fmtTs(p.createdAt)} />
                <Row label="Last updated" value={fmtTs(p.updatedAt)} />
                {p.updatedBy && <Row label="Updated by" value={p.updatedBy} />}
              </section>
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4">
              <Button variant="outline" className="w-full" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
