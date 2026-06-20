import { useState } from 'react'
import { getAuth } from 'firebase/auth'
import { getDocs, collection, query, where, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createRoom } from '@/features/rooms/services/roomService'
import type { RoomType } from '@/features/rooms/types'

export function AdHocRoomForm({
  campId,
  participantGender,
  lockedRoomType,
  onCreated,
  onCancel,
}: {
  campId: string
  participantGender: 'M' | 'F'
  lockedRoomType: RoomType
  onCreated: (roomId: string, roomNumber: string) => void
  onCancel: () => void
}) {
  const [number, setNumber] = useState('')
  const [capacityStr, setCapacityStr] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const roomTypeId = lockedRoomType.id
  const selectedType = lockedRoomType

  async function handleCreate() {
    setError('')
    const trimmedNumber = number.trim()
    if (!trimmedNumber) { setError('Room number is required'); return }

    setBusy(true)
    try {
      // Uniqueness check: (campId, gender, number)
      const dup = await getDocs(
        query(
          collection(db, 'camps', campId, 'rooms'),
          where('gender', '==', participantGender),
          where('number', '==', trimmedNumber),
          limit(1),
        ),
      )
      if (!dup.empty) {
        setError(`A ${participantGender === 'M' ? 'male' : 'female'} room "${trimmedNumber}" already exists`)
        setBusy(false)
        return
      }

      const capacity =
        capacityStr.trim() !== '' ? parseInt(capacityStr, 10) : selectedType?.defaultCapacity ?? 1

      const uid = getAuth().currentUser?.uid ?? 'admin'
      const roomId = await createRoom(
        campId,
        {
          number: trimmedNumber,
          roomTypeId,
          roomTypeName: selectedType?.name ?? '',
          gender: participantGender,
          capacity,
          notes: notes.trim() || undefined,
        },
        uid,
      )

      onCreated(roomId, trimmedNumber)
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to create room')
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <p className="text-sm font-medium">New room</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Number *</Label>
          <Input
            autoFocus
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. 204"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Capacity (optional)</Label>
          <Input
            type="number"
            min={1}
            value={capacityStr}
            onChange={(e) => setCapacityStr(e.target.value)}
            placeholder={`Default: ${selectedType?.defaultCapacity ?? '—'}`}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Room type</Label>
        <Input
          value={lockedRoomType.name}
          readOnly
          disabled
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Gender</Label>
        <Input
          value={participantGender === 'M' ? 'Male' : 'Female'}
          readOnly
          disabled
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Notes (optional)</Label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Corner room, near bathroom"
          className="h-8 text-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={handleCreate} disabled={busy || !number.trim() || !roomTypeId}>
          {busy ? 'Creating…' : 'Create room'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
