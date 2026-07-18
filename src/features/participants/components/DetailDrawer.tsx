import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import { AlertTriangle, DoorOpen, X, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { Timestamp } from 'firebase/firestore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatMoney } from '@/lib/formatMoney'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import {
  listAllocationsByParticipant,
  voidAllocation,
} from '@/features/payments/services/allocationService'
import type { Allocation } from '@/features/payments/types'
import { listSmsLogForParticipant } from '@/features/sms/services/smsLogService'
import type { SmsLogEntry } from '@/features/sms/types'
import {
  cancelRegistration,
  restoreRegistration,
  undoCheckIn,
  changeRoomType,
  waiveFee,
  editNotes,
  addTag,
  removeTag,
  unassignRoom,
  clearRoomedWithoutFullPaymentFlag,
} from '../services/participantService'
import { type Participant, type PaymentState, derivePaymentState } from '../types'
import { OverridePaymentModal } from './OverridePaymentModal'
import { RoomPickerModal } from './RoomPickerModal'

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function getUpdatedBy(): string {
  const user = getAuth().currentUser
  return user?.email ?? user?.uid ?? 'admin'
}

// ─── component ────────────────────────────────────────────────────────────────

export function DetailDrawer({
  participant,
  currency,
  onClose,
  onMutated,
}: {
  participant: Participant | null
  currency: string
  onClose: () => void
  onMutated: () => void
}) {
  const { id: campId } = useParams<{ id: string }>()
  const { roomTypes } = useCampData()

  const open = participant !== null

  // Local state for optimistic updates — stays non-null during close animation
  const [local, setLocal] = useState<Participant | null>(null)
  useEffect(() => {
    if (participant !== null) setLocal(participant)
  }, [participant])

  const p = local
  const paymentState = p ? derivePaymentState(p) : null

  // ─── allocations ─────────────────────────────────────────────────────────────
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [allocError, setAllocError] = useState(false)
  const [voidTarget, setVoidTarget] = useState<Allocation | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)

  const loadAllocations = useCallback(async () => {
    if (!campId || !participant) return
    setAllocError(false)
    try {
      const allocs = await listAllocationsByParticipant(campId, participant.id)
      allocs.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
      setAllocations(allocs)
    } catch {
      setAllocError(true)
    }
  }, [campId, participant])

  useEffect(() => {
    if (participant) loadAllocations()
    else setAllocations([])
  }, [participant, loadAllocations])

  // ─── room-text send log ─────────────────────────────────────────────────────
  const [smsLog, setSmsLog] = useState<SmsLogEntry[]>([])

  useEffect(() => {
    if (!campId || !participant) { setSmsLog([]); return }
    listSmsLogForParticipant(campId, participant.id).then(setSmsLog).catch(() => setSmsLog([]))
  }, [campId, participant])

  const latestRoomSms = smsLog.find((e) => e.trigger === 'ROOM_ASSIGNED' || e.trigger === 'ROOM_CHANGED')

  async function handleVoidAllocation() {
    if (!voidTarget || !campId || !voidReason.trim()) return
    setVoiding(true)
    try {
      await voidAllocation(campId, voidTarget.id, voidReason, getUpdatedBy())
      toast.success('Allocation voided')
      setVoidTarget(null)
      setVoidReason('')
      await loadAllocations()
      onMutated() // refreshes amountPaid in the parent list
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to void')
    } finally {
      setVoiding(false)
    }
  }

  // ─── UI state ───────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmUnassign, setConfirmUnassign] = useState(false)
  const [confirmUndoCheckIn, setConfirmUndoCheckIn] = useState(false)
  const [confirmClearFlag, setConfirmClearFlag] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState('')
  const [showRTModal, setShowRTModal] = useState(false)
  const [selectedRTId, setSelectedRTId] = useState('')
  const [showWaiveModal, setShowWaiveModal] = useState(false)
  const [waiverNote, setWaiverNote] = useState('')

  // Room assignment flow
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [pendingOverrideReason, setPendingOverrideReason] = useState<string | null>(null)
  const [showRoomPicker, setShowRoomPicker] = useState(false)

  // Reset ephemeral UI on participant change
  useEffect(() => {
    setConfirmCancel(false)
    setConfirmUnassign(false)
    setConfirmUndoCheckIn(false)
    setConfirmClearFlag(false)
    setEditingNotes(false)
    setTagInput('')
    setShowRTModal(false)
    setShowWaiveModal(false)
    setShowOverrideModal(false)
    setShowRoomPicker(false)
    setPendingOverrideReason(null)
  }, [participant?.id])

  // ─── mutation helper ─────────────────────────────────────────────────────────

  async function run(
    fn: () => Promise<unknown>,
    optimistic?: (prev: Participant) => Participant,
  ): Promise<boolean> {
    if (!p || !campId || busy) return false
    const prevLocal = local
    setBusy(true)
    try {
      if (optimistic) setLocal(optimistic(p))
      await fn()
      onMutated()
      return true
    } catch (err: unknown) {
      setLocal(prevLocal)
      toast.error((err as Error)?.message ?? 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  // ─── actions ─────────────────────────────────────────────────────────────────

  async function handleCancel() {
    const ok = await run(
      () => cancelRegistration(campId!, p!.id, getUpdatedBy()),
      (prev) => ({ ...prev, registrationState: 'CANCELLED' as const }),
    )
    if (ok) { setConfirmCancel(false); toast.success('Registration cancelled') }
  }

  async function handleRestore() {
    const ok = await run(
      () => restoreRegistration(campId!, p!.id, getUpdatedBy()),
      (prev) => ({ ...prev, registrationState: 'REGISTERED' as const }),
    )
    if (ok) toast.success('Registration restored')
  }

  async function handleUndoCheckIn() {
    const ok = await run(
      () => undoCheckIn(campId!, p!.id, getUpdatedBy()),
      (prev) => ({ ...prev, checkInState: 'NOT_ARRIVED' as const, checkedInBy: undefined, checkedInAt: undefined }),
    )
    if (ok) toast.success('Check-in undone')
  }

  async function handleChangeRoomType() {
    const rt = roomTypes.find((r) => r.id === selectedRTId)
    if (!rt || !p) return
    const ok = await run(
      () => changeRoomType(campId!, p.id, rt.id, rt.name, rt.price, getUpdatedBy()),
      (prev) => ({ ...prev, roomTypePreferenceId: rt.id, roomTypePreferenceName: rt.name, feeOwed: rt.price }),
    )
    if (ok) { setShowRTModal(false); toast.success('Room type updated') }
  }

  async function handleWaiveFee() {
    if (!waiverNote.trim()) return
    const ok = await run(
      () => waiveFee(campId!, p!.id, waiverNote.trim(), getUpdatedBy()),
      (prev) => ({ ...prev, feeOwed: 0, feeWaiverNote: waiverNote.trim() }),
    )
    if (ok) { setShowWaiveModal(false); setWaiverNote(''); toast.success('Fee waived') }
  }

  async function handleSaveNotes() {
    const ok = await run(
      () => editNotes(campId!, p!.id, notesText, getUpdatedBy()),
      (prev) => ({ ...prev, notes: notesText.trim() || undefined }),
    )
    if (ok) { setEditingNotes(false); toast.success('Notes saved') }
  }

  async function handleAddTag() {
    const tag = tagInput.trim()
    if (!tag || !p) return
    if ((p.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())) {
      toast.error('Tag already exists'); return
    }
    const ok = await run(
      () => addTag(campId!, p.id, tag, getUpdatedBy()),
      (prev) => ({ ...prev, tags: [...(prev.tags ?? []), tag] }),
    )
    if (ok) setTagInput('')
  }

  async function handleRemoveTag(tag: string) {
    await run(
      () => removeTag(campId!, p!.id, tag, getUpdatedBy()),
      (prev) => ({ ...prev, tags: (prev.tags ?? []).filter((t) => t !== tag) }),
    )
  }

  async function handleUnassignRoom() {
    if (!p?.roomId) return
    const prevRoom = p.roomNumber ?? p.roomId
    const ok = await run(
      () => unassignRoom(campId!, p!.id, p!.roomId!, getUpdatedBy()),
      (prev) => ({ ...prev, roomId: undefined, roomNumber: undefined, roomAssignedBy: undefined, roomAssignedAt: undefined }),
    )
    if (ok) { setConfirmUnassign(false); toast.success(`Unassigned from Room ${prevRoom}`) }
  }

  async function handleClearFlag() {
    const ok = await run(
      () => clearRoomedWithoutFullPaymentFlag(campId!, p!.id, getUpdatedBy()),
      (prev) => ({ ...prev, roomedWithoutFullPayment: false }),
    )
    if (ok) { setConfirmClearFlag(false); toast.success('Override flag cleared') }
  }

  // ─── room assignment flow ────────────────────────────────────────────────────

  function handleAssignRoomClick() {
    if (!p) return
    if (paymentState === 'PENDING' || paymentState === 'PARTIAL') {
      setShowOverrideModal(true)
    } else {
      setPendingOverrideReason(null)
      setShowRoomPicker(true)
    }
  }

  function handleOverrideProceed(reason: string) {
    setPendingOverrideReason(reason)
    setShowOverrideModal(false)
    setShowRoomPicker(true)
  }

  function handleRoomAssigned(roomNumber: string) {
    setShowRoomPicker(false)
    setPendingOverrideReason(null)
    toast.success(`Assigned to Room ${roomNumber}. Checked in.`)
    onMutated()
  }

  // ─── computed ────────────────────────────────────────────────────────────────

  const newRoomTypeFee = roomTypes.find((r) => r.id === selectedRTId)?.price

  const roomTypeChangeBlock = p?.confirmedBatchId
    ? "Payment is confirmed — room type can't be changed. Reversing a confirmed payment isn't supported in v1."
    : p?.paymentClaimed
    ? 'This participant is claimed for payment — clear the claim before changing their room type.'
    : null

  // ─── render ──────────────────────────────────────────────────────────────────

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
              <Badge variant={p.registrationState === 'REGISTERED' ? 'default' : 'destructive'}>
                {p.registrationState}
              </Badge>
              {paymentState && <PaymentBadge state={paymentState} />}
              <Badge variant={p.checkInState === 'ARRIVED' ? 'default' : 'secondary'}>
                {p.checkInState === 'ARRIVED' ? 'Checked in' : 'Not arrived'}
              </Badge>
              {p.roomNumber && <Badge variant="outline">Room {p.roomNumber}</Badge>}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">

              {/* Warning banners */}
              {p.registrationState === 'CANCELLED' && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  This registration has been cancelled.
                </div>
              )}

              {/* Override flag banner — permanent audit trail */}
              {p.roomedWithoutFullPayment && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive space-y-2">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Roomed with outstanding balance
                    {p.roomedWithoutFullPaymentNote && (
                      <span className="font-normal"> — Reason: "{p.roomedWithoutFullPaymentNote}"</span>
                    )}
                  </p>
                  {confirmClearFlag ? (
                    <div className="space-y-1.5">
                      <p className="text-xs">
                        Clear this flag? The reason note will be preserved for audit.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleClearFlag}
                          disabled={busy}
                          className="h-6 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                        >
                          Yes, mark resolved
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmClearFlag(false)}
                          className="h-6 px-2 text-xs"
                        >
                          Keep
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearFlag(true)}
                      className="text-xs underline underline-offset-2 hover:no-underline"
                    >
                      Mark as resolved
                    </button>
                  )}
                </div>
              )}

              {/* Dynamic balance warning — shown only when flag isn't already set */}
              {!p.roomedWithoutFullPayment && !!p.roomId && paymentState !== 'PAID' && paymentState !== 'WAIVED' && (
                <div className="flex items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Roomed with outstanding balance
                </div>
              )}

              {/* Tags */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
                <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                  {(p.tags ?? []).length === 0 ? (
                    <span className="text-sm text-muted-foreground">No tags</span>
                  ) : (
                    (p.tags ?? []).map((tag, i) => (
                      <span
                        key={`${tag}-${i}`}
                        className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          disabled={busy}
                          className="ml-0.5 rounded-full text-muted-foreground hover:text-destructive disabled:opacity-50"
                          aria-label={`Remove tag ${tag}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag() } }}
                    placeholder="Add tag…"
                    className="h-7 text-sm"
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddTag}
                    disabled={busy || !tagInput.trim()}
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </section>

              <Separator />

              {/* Registration */}
              <section className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registration</p>
                <Row label="Sub-group" value={p.subGroupName} />
                <Row
                  label="Room type"
                  value={
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        {p.roomTypePreferenceName}
                        <button
                          type="button"
                          onClick={() => { setSelectedRTId(p.roomTypePreferenceId); setShowRTModal(true) }}
                          className="text-xs text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={busy || !!roomTypeChangeBlock}
                        >
                          Change
                        </button>
                      </span>
                      {roomTypeChangeBlock && (
                        <span className="text-xs text-muted-foreground">{roomTypeChangeBlock}</span>
                      )}
                    </span>
                  }
                />
                {p.email && <Row label="Email" value={p.email} />}
              </section>

              <Separator />

              {/* Payment */}
              <section className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment</p>
                <Row label="Fee owed" value={formatMoney(p.feeOwed, currency)} />
                <Row label="Amount paid" value={formatMoney(p.amountPaid, currency)} />
                {p.feeOwed > 0 && p.amountPaid < p.feeOwed && (
                  <Row
                    label="Balance due"
                    value={<span className="font-medium text-destructive">{formatMoney(p.feeOwed - p.amountPaid, currency)}</span>}
                  />
                )}
                {p.feeOwed > 0 && p.amountPaid > p.feeOwed && (
                  <Row
                    label="Credit"
                    value={<span className="font-medium text-emerald-600">{formatMoney(p.amountPaid - p.feeOwed, currency)}</span>}
                  />
                )}
                {p.feeWaiverNote && (
                  <Row label="Waiver note" value={<span className="italic text-muted-foreground">{p.feeWaiverNote}</span>} />
                )}
                {paymentState !== 'WAIVED' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setWaiverNote(''); setShowWaiveModal(true) }}
                    disabled={busy}
                    className="mt-1"
                  >
                    Waive fee
                  </Button>
                )}

                {/* Allocations list */}
                {allocError && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Couldn't load payment history.{' '}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => loadAllocations()}
                    >
                      Retry
                    </button>
                  </p>
                )}
                {!allocError && allocations.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Allocations</p>
                    {allocations.map((a) => (
                      <div
                        key={a.id}
                        className={`flex items-center justify-between rounded border px-2.5 py-1.5 text-xs ${
                          a.voided ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-mono">{a.batchReferenceCode}</span>
                          {a.voided && (
                            <span className="ml-2 text-muted-foreground">voided</span>
                          )}
                        </div>
                        <div className="ml-3 flex shrink-0 items-center gap-2">
                          <span className="tabular-nums font-medium">
                            {formatMoney(a.amount, currency)}
                          </span>
                          {!a.voided && (
                            <button
                              type="button"
                              onClick={() => { setVoidTarget(a); setVoidReason('') }}
                              className="text-muted-foreground hover:text-destructive"
                              disabled={busy}
                            >
                              Void
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              {/* Room assignment — always visible for REGISTERED participants */}
              {p.registrationState === 'REGISTERED' && (
                <section className="space-y-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Room assignment
                  </p>

                  {p.roomId ? (
                    <>
                      <Row label="Room" value={`Room ${p.roomNumber ?? p.roomId}`} />
                      {p.roomAssignedAt && <Row label="Assigned at" value={fmtTs(p.roomAssignedAt)} />}
                      {p.roomAssignedBy && <Row label="Assigned by" value={p.roomAssignedBy} />}
                      {p.checkedInAt && <Row label="Checked in at" value={fmtTs(p.checkedInAt)} />}
                      {p.checkedInBy && <Row label="Checked in by" value={p.checkedInBy} />}
                      <Row
                        label="Room text"
                        value={
                          !latestRoomSms
                            ? 'Not sent yet'
                            : latestRoomSms.status === 'SENT'
                            ? `Sent ${fmtTs(latestRoomSms.createdAt)}`
                            : latestRoomSms.status === 'FAILED'
                            ? <span className="text-destructive">Failed — {latestRoomSms.providerError ?? 'unknown error'}</span>
                            : latestRoomSms.status === 'SKIPPED'
                            ? <span className="text-muted-foreground">Skipped — {latestRoomSms.reason ?? 'unknown reason'}</span>
                            : 'Pending'
                        }
                      />

                      <div className="flex flex-wrap gap-2 pt-1">
                        {/* Change Room button */}
                        <Button
                          type="button"
                          size="sm"
                          variant={paymentState === 'PAID' || paymentState === 'WAIVED' ? 'default' : 'outline'}
                          onClick={handleAssignRoomClick}
                          disabled={busy}
                          className={
                            paymentState !== 'PAID' && paymentState !== 'WAIVED'
                              ? 'border-amber-300 text-amber-800 hover:bg-amber-50 gap-1'
                              : 'gap-1'
                          }
                        >
                          {(paymentState === 'PENDING' || paymentState === 'PARTIAL') && (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          <DoorOpen className="h-3.5 w-3.5" />
                          Change Room
                        </Button>

                        {/* Unassign Room */}
                        {confirmUnassign ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              Unassign from Room {p.roomNumber}? They stay checked in.
                            </span>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={handleUnassignRoom}
                              disabled={busy}
                            >
                              Unassign
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmUnassign(false)}
                            >
                              Keep
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmUnassign(true)}
                            disabled={busy}
                            className="text-muted-foreground"
                          >
                            Unassign Room
                          </Button>
                        )}

                        {/* Undo check-in (if checked in) */}
                        {p.checkInState === 'ARRIVED' && (
                          confirmUndoCheckIn ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-muted-foreground">Undo check-in?</span>
                              <Button size="sm" variant="destructive" onClick={handleUndoCheckIn} disabled={busy}>
                                Undo
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmUndoCheckIn(false)}>
                                Keep
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmUndoCheckIn(true)}
                              disabled={busy}
                              className="text-muted-foreground"
                            >
                              Undo check-in
                            </Button>
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {p.checkInState === 'ARRIVED' && (
                        <Row label="Status" value="Checked in (no room assigned)" />
                      )}
                      {p.checkedInAt && <Row label="Checked in at" value={fmtTs(p.checkedInAt)} />}
                      {p.checkedInBy && <Row label="Checked in by" value={p.checkedInBy} />}

                      <div className="flex flex-wrap gap-2 pt-1">
                        {/* Assign Room button */}
                        <Button
                          type="button"
                          size="sm"
                          variant={paymentState === 'PAID' || paymentState === 'WAIVED' ? 'default' : 'outline'}
                          onClick={handleAssignRoomClick}
                          disabled={busy}
                          className={
                            paymentState !== 'PAID' && paymentState !== 'WAIVED'
                              ? 'border-amber-300 text-amber-800 hover:bg-amber-50 gap-1'
                              : 'gap-1'
                          }
                        >
                          {(paymentState === 'PENDING' || paymentState === 'PARTIAL') && (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          <DoorOpen className="h-3.5 w-3.5" />
                          Assign Room
                        </Button>

                        {p.checkInState === 'ARRIVED' && (
                          confirmUndoCheckIn ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-muted-foreground">Undo check-in?</span>
                              <Button size="sm" variant="destructive" onClick={handleUndoCheckIn} disabled={busy}>
                                Undo
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmUndoCheckIn(false)}>
                                Keep
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmUndoCheckIn(true)}
                              disabled={busy}
                              className="text-muted-foreground"
                            >
                              Undo check-in
                            </Button>
                          )
                        )}
                      </div>
                    </>
                  )}
                </section>
              )}

              {/* Notes */}
              <Separator />
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                  {!editingNotes && (
                    <button
                      type="button"
                      onClick={() => { setNotesText(p.notes ?? ''); setEditingNotes(true) }}
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                      disabled={busy}
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="space-y-2">
                    <Textarea
                      value={notesText}
                      onChange={(e) => setNotesText(e.target.value)}
                      rows={3}
                      placeholder="Add a note…"
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveNotes} disabled={busy}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingNotes(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm">
                    {p.notes || <span className="text-muted-foreground">No notes</span>}
                  </p>
                )}
              </section>

              {/* Audit */}
              <Separator />
              <section className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit</p>
                <Row label="Registered at" value={fmtTs(p.createdAt)} />
                <Row label="Last updated" value={fmtTs(p.updatedAt)} />
                {p.updatedBy && <Row label="Updated by" value={p.updatedBy} />}
              </section>

              {/* Actions */}
              <Separator />
              <section className="space-y-2 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</p>
                {p.registrationState === 'REGISTERED' ? (
                  confirmCancel ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                      <p className="text-sm text-destructive">Cancel this registration? This cannot be easily undone.</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" onClick={handleCancel} disabled={busy}>
                          Yes, cancel
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                          Keep
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmCancel(true)}
                      disabled={busy}
                      className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50"
                    >
                      Cancel registration
                    </Button>
                  )
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRestore}
                    disabled={busy}
                  >
                    Restore registration
                  </Button>
                )}
              </section>
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4">
              <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
            </div>

            {/* Change Room Type Dialog */}
            <Dialog open={showRTModal} onOpenChange={setShowRTModal}>
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Change room type preference</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Changing the room type will update the fee owed.</p>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {roomTypes.map((rt) => (
                      <label
                        key={rt.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 text-sm hover:bg-muted"
                      >
                        <input
                          type="radio"
                          name="room-type-select"
                          value={rt.id}
                          checked={selectedRTId === rt.id}
                          onChange={() => setSelectedRTId(rt.id)}
                          className="h-4 w-4"
                        />
                        <span className="flex-1">{rt.name}</span>
                        <span className="text-muted-foreground">{formatMoney(rt.price, currency)}</span>
                      </label>
                    ))}
                  </div>
                  {p && newRoomTypeFee !== undefined && newRoomTypeFee !== p.feeOwed && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Fee will change from {formatMoney(p.feeOwed, currency)} to {formatMoney(newRoomTypeFee, currency)}.
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowRTModal(false)}>Cancel</Button>
                  <Button
                    onClick={handleChangeRoomType}
                    disabled={busy || !selectedRTId || selectedRTId === p?.roomTypePreferenceId}
                  >
                    Confirm change
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Void Allocation Dialog */}
            <Dialog open={!!voidTarget} onOpenChange={(v) => !v && setVoidTarget(null)}>
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Void allocation</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Void {voidTarget ? formatMoney(voidTarget.amount, currency) : ''} from{' '}
                    <span className="font-mono">{voidTarget?.batchReferenceCode}</span>?
                    This decrements this participant's amountPaid and the batch total.
                    If the batch was reconciled it will reopen.
                  </p>
                  <Textarea
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Reason for voiding…"
                    rows={3}
                    className="text-sm"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setVoidTarget(null)} disabled={voiding}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleVoidAllocation}
                    disabled={voiding || !voidReason.trim()}
                  >
                    {voiding ? 'Voiding…' : 'Void allocation'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Waive Fee Dialog */}
            <Dialog open={showWaiveModal} onOpenChange={setShowWaiveModal}>
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Waive fee</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Sets fee owed to {formatMoney(0, currency)}. Provide a reason.
                  </p>
                  <Textarea
                    value={waiverNote}
                    onChange={(e) => setWaiverNote(e.target.value)}
                    placeholder="Reason for waiving fee…"
                    rows={3}
                    className="text-sm"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowWaiveModal(false)}>Cancel</Button>
                  <Button onClick={handleWaiveFee} disabled={busy || !waiverNote.trim()}>Waive fee</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>

      {/* Override payment modal — renders outside the panel so z-index is clean */}
      {showOverrideModal && p && (
        <OverridePaymentModal
          participantName={p.fullName}
          balanceDue={p.feeOwed - p.amountPaid}
          currency={currency}
          onCancel={() => setShowOverrideModal(false)}
          onProceed={handleOverrideProceed}
        />
      )}

      {/* Room picker modal */}
      {showRoomPicker && p && (
        <RoomPickerModal
          participant={p}
          overrideReason={pendingOverrideReason}
          onAssigned={handleRoomAssigned}
          onClose={() => { setShowRoomPicker(false); setPendingOverrideReason(null) }}
        />
      )}
    </>
  )
}
