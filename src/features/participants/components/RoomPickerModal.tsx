import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import { AlertTriangle, Info, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { listRooms } from '@/features/rooms/services/roomService'
import type { Room } from '@/features/rooms/types'
import { assignRoom } from '../services/participantService'
import type { Participant } from '../types'
import { AdHocRoomForm } from './AdHocRoomForm'

// Natural sort on room number strings: "204" before "1004"
function naturalSort(a: Room, b: Room) {
  return a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' })
}

// Derive "3× Choir, 1× Youth" for a room's current occupants
function subGroupLabel(roomId: string, participants: Participant[]): string {
  const occupants = participants.filter(
    (p) => p.roomId === roomId && p.registrationState === 'REGISTERED',
  )
  if (occupants.length === 0) return ''
  const counts: Record<string, number> = {}
  for (const p of occupants) {
    counts[p.subGroupName] = (counts[p.subGroupName] ?? 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count}× ${name}`)
    .join(', ')
}

export function RoomPickerModal({
  participant,
  overrideReason,
  onAssigned,
  onClose,
}: {
  participant: Participant
  overrideReason: string | null
  onAssigned: (roomNumber: string) => void
  onClose: () => void
}) {
  const { id: campId } = useParams<{ id: string }>()
  const { roomTypes, participants } = useCampData()

  // Rooms are fetched once, filtered to gender only — the room-type filter is
  // applied client-side via `showAllTypes` so toggling it is instant.
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [showAdHoc, setShowAdHoc] = useState(false)
  const [showAllTypes, setShowAllTypes] = useState(false)
  const [highlightedRoomId, setHighlightedRoomId] = useState<string | null>(null)
  const [pendingOverbookRoom, setPendingOverbookRoom] = useState<Room | null>(null)
  // Different-type confirmation — set when the admin clicks a room whose type
  // doesn't match what the participant registered for. Reason is required.
  const [pendingDifferentTypeRoom, setPendingDifferentTypeRoom] = useState<Room | null>(null)
  const [differentTypeReasonDraft, setDifferentTypeReasonDraft] = useState('')
  // Carries a confirmed different-type reason through a SECOND confirmation
  // (soft overbook) when a non-matching room is also at capacity.
  const [confirmedDifferentTypeReason, setConfirmedDifferentTypeReason] = useState<string | null>(null)
  const highlightRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!campId) return
    setLoading(true)
    listRooms(campId).then((all) => {
      setRooms(all.filter((r) => r.gender === participant.gender))
      setLoading(false)
    })
  }, [campId, participant.gender])

  // Scroll to highlighted room when it appears after ad-hoc creation
  useEffect(() => {
    if (highlightedRoomId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [highlightedRoomId, rooms])

  async function refetchRooms() {
    if (!campId) return
    const all = await listRooms(campId)
    setRooms(all.filter((r) => r.gender === participant.gender))
  }

  function handleAdHocCreated(roomId: string, roomNumber: string) {
    setShowAdHoc(false)
    refetchRooms().then(() => setHighlightedRoomId(roomId))
    toast.success(`Room ${roomNumber} created`)
  }

  async function doAssign(room: Room, differentTypeReason: string | null) {
    if (!campId || assigning) return
    setAssigning(true)
    setPendingOverbookRoom(null)
    setPendingDifferentTypeRoom(null)
    try {
      const uid = getAuth().currentUser?.email ?? getAuth().currentUser?.uid ?? 'admin'
      const roomNumber = await assignRoom(
        campId,
        participant.id,
        participant.gender,
        participant.roomTypePreferenceId,
        participant.roomTypePreferenceName,
        participant.roomId ?? null,
        room.id,
        roomTypes,
        overrideReason,
        differentTypeReason,
        uid,
      )
      onAssigned(roomNumber)
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? 'Assignment failed')
    } finally {
      setAssigning(false)
      setConfirmedDifferentTypeReason(null)
    }
  }

  function handleRoomClick(room: Room) {
    // Prevent re-assigning the same room
    if (room.id === participant.roomId) return

    const rt = roomTypes.find((r) => r.id === room.roomTypeId)
    const isFull = room.currentOccupancy >= room.capacity
    if (isFull && !rt?.allowOverbook) return // hard cap — disabled, shouldn't be clicked

    const isDifferentType = room.roomTypeId !== participant.roomTypePreferenceId
    if (isDifferentType) {
      setDifferentTypeReasonDraft('')
      setPendingDifferentTypeRoom(room)
      return
    }

    if (isFull) {
      // Soft overbook: ask for confirm
      setPendingOverbookRoom(room)
      return
    }

    doAssign(room, null)
  }

  function handleDifferentTypeConfirm() {
    const room = pendingDifferentTypeRoom
    const reason = differentTypeReasonDraft.trim()
    if (!room || reason.length < 3) return
    setPendingDifferentTypeRoom(null)

    const rt = roomTypes.find((r) => r.id === room.roomTypeId)
    const isFull = room.currentOccupancy >= room.capacity
    if (isFull && rt?.allowOverbook) {
      // Still needs the soft-overbook confirmation too — carry the reason forward.
      setConfirmedDifferentTypeReason(reason)
      setPendingOverbookRoom(room)
      return
    }

    doAssign(room, reason)
  }

  // Group visible rooms by type. Default view shows only the participant's
  // registered type; "Show all room types" widens this (gender stays filtered
  // upstream). The registered type's group always sorts first.
  const groups = useMemo(() => {
    const visible = showAllTypes
      ? rooms
      : rooms.filter((r) => r.roomTypeId === participant.roomTypePreferenceId)

    const byType = new Map<string, Room[]>()
    for (const r of visible) {
      const list = byType.get(r.roomTypeId)
      if (list) list.push(r)
      else byType.set(r.roomTypeId, [r])
    }

    return [...byType.entries()]
      .map(([roomTypeId, typeRooms]) => {
        const rt = roomTypes.find((t) => t.id === roomTypeId)
        return {
          roomTypeId,
          typeName: typeRooms[0].roomTypeName,
          allowOverbook: rt?.allowOverbook ?? false,
          order: rt?.order ?? 0,
          isPreferred: roomTypeId === participant.roomTypePreferenceId,
          rooms: typeRooms.slice().sort(naturalSort),
        }
      })
      .sort((a, b) => {
        if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1
        return a.order - b.order
      })
  }, [rooms, roomTypes, participant.roomTypePreferenceId, showAllTypes])

  const preferredType = roomTypes.find((rt) => rt.id === participant.roomTypePreferenceId)
  const genderLabel = participant.gender === 'M' ? 'M' : 'F'
  const genderWord = participant.gender === 'M' ? 'male' : 'female'

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !assigning) onClose() }}>
      <DialogContent className="max-h-[85vh] flex flex-col p-0 gap-0 sm:max-w-lg">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle>
            Assign room for {participant.fullName} ({genderLabel})
          </DialogTitle>
          {overrideReason && (
            <p className="text-xs text-status-partial mt-1">
              Override: "{overrideReason}"
            </p>
          )}
        </DialogHeader>

        <DialogBody className="px-5 py-3 space-y-4">
          {/* Show all room types toggle */}
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={showAllTypes}
              onCheckedChange={setShowAllTypes}
              className="scale-90"
            />
            <span>
              Show all room types
              <span className="ml-1 text-xs text-muted-foreground">
                (gender filter still applies)
              </span>
            </span>
          </label>

          {/* Different-type confirmation */}
          {pendingDifferentTypeRoom && (
            <div className="rounded-md border border-status-partial/30 bg-status-partial-bg p-3 space-y-2">
              <p className="text-sm font-medium text-status-partial flex items-center gap-1.5">
                <Info className="h-4 w-4 shrink-0" />
                {participant.fullName} registered for {participant.roomTypePreferenceName} but
                Room {pendingDifferentTypeRoom.number} is a {pendingDifferentTypeRoom.roomTypeName}.
                Assign anyway?
              </p>
              <Textarea
                autoFocus
                value={differentTypeReasonDraft}
                onChange={(e) => setDifferentTypeReasonDraft(e.target.value)}
                placeholder='Reason, e.g. "Premium full"'
                rows={2}
                className="text-sm bg-background"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleDifferentTypeConfirm}
                  disabled={assigning || differentTypeReasonDraft.trim().length < 3}
                  className="border border-status-partial/40 bg-status-partial-bg text-status-partial hover:bg-status-partial-bg/70"
                >
                  {assigning ? 'Assigning…' : 'Assign anyway'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingDifferentTypeRoom(null)}
                  disabled={assigning}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Overbook confirmation banner */}
          {pendingOverbookRoom && (
            <div className="rounded-md border border-status-partial/30 bg-status-partial-bg p-3 space-y-2">
              <p className="text-sm font-medium text-status-partial flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Room {pendingOverbookRoom.number} is at capacity (
                {pendingOverbookRoom.currentOccupancy}/{pendingOverbookRoom.capacity}). Assign anyway?
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => doAssign(pendingOverbookRoom, confirmedDifferentTypeReason)}
                  disabled={assigning}
                  className="border border-status-partial/40 bg-status-partial-bg text-status-partial hover:bg-status-partial-bg/70"
                >
                  {assigning ? 'Assigning…' : 'Yes, assign'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setPendingOverbookRoom(null); setConfirmedDifferentTypeReason(null) }}
                  disabled={assigning}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Ad-hoc room creation — type locked to what the participant paid for */}
          {showAdHoc && preferredType ? (
            <AdHocRoomForm
              campId={campId!}
              participantGender={participant.gender}
              lockedRoomType={preferredType}
              onCreated={handleAdHocCreated}
              onCancel={() => setShowAdHoc(false)}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowAdHoc(true)}
              disabled={assigning || !preferredType}
            >
              <Plus className="h-3.5 w-3.5" />
              Add new room of {preferredType?.name ?? '—'}
            </Button>
          )}

          {/* Room list */}
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading rooms…</p>
          ) : groups.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground space-y-2">
              {showAllTypes ? (
                <p>No rooms available for {genderWord} participants at all.</p>
              ) : (
                <>
                  <p>
                    No {preferredType?.name ?? 'matching'} rooms available for {genderWord} participants.
                  </p>
                  <p>
                    Turn on "Show all room types" above to assign a different type without
                    changing their fee, or change this participant's room type in their detail
                    drawer if the fee should change too.
                  </p>
                </>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.roomTypeId}>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.typeName}
                  {!group.isPreferred && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-status-partial-bg px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-status-partial">
                      <Info className="h-2.5 w-2.5" />
                      Different type
                    </span>
                  )}
                </p>
                <div className="space-y-1">
                  {group.rooms.map((room) => {
                    const isFull = room.currentOccupancy >= room.capacity
                    const isOverbook = isFull && group.allowOverbook
                    const isHardFull = isFull && !group.allowOverbook
                    const isCurrent = room.id === participant.roomId
                    const isHighlighted = room.id === highlightedRoomId
                    const occupancyLabel = isFull
                      ? `FULL (${room.currentOccupancy}/${room.capacity})`
                      : `${room.currentOccupancy}/${room.capacity} occupied`
                    const sgLabel = subGroupLabel(room.id, participants)

                    return (
                      <button
                        key={room.id}
                        type="button"
                        ref={isHighlighted ? highlightRef : undefined}
                        disabled={isHardFull || isCurrent || assigning}
                        onClick={() => handleRoomClick(room)}
                        className={`w-full rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                          isHighlighted
                            ? 'border-primary ring-1 ring-primary/50 bg-primary/5'
                            : isCurrent
                            ? 'border-border bg-muted/40 opacity-60 cursor-not-allowed'
                            : isHardFull
                            ? 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
                            : isOverbook
                            ? 'border-status-partial/40 bg-status-partial-bg hover:bg-status-partial-bg/70 cursor-pointer'
                            : 'border-input bg-background hover:bg-muted cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-semibold">
                            {room.number}
                            {isCurrent && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                (current)
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isOverbook && (
                              <span className="rounded-full bg-status-partial-bg px-1.5 py-0.5 text-xs font-semibold text-status-partial">
                                OVER
                              </span>
                            )}
                            {isHardFull && (
                              <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                                FULL
                              </span>
                            )}
                            <span className={`text-xs ${isFull ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                              {occupancyLabel}
                            </span>
                          </div>
                        </div>
                        {sgLabel && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Currently: {sgLabel}
                          </p>
                        )}
                        {room.notes && (
                          <p className="mt-0.5 text-xs text-muted-foreground italic">
                            {room.notes}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </DialogBody>

        <div className="border-t px-5 py-3 shrink-0">
          <Button variant="outline" className="w-full" onClick={onClose} disabled={assigning}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
