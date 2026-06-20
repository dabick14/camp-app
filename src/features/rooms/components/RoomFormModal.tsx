import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { deleteField } from 'firebase/firestore'
import { auth } from '@/lib/firebase'
import { createRoom, updateRoom } from '../services/roomService'
import type { Room, RoomType } from '../types'

interface RoomFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campId: string
  roomTypes: RoomType[]
  existingRooms: Room[]
  editRoom?: Room | null
  onSaved: () => void
}

export function RoomFormModal({
  open,
  onOpenChange,
  campId,
  roomTypes,
  existingRooms,
  editRoom,
  onSaved,
}: RoomFormModalProps) {
  const isEdit = Boolean(editRoom)
  const locked = isEdit && (editRoom?.currentOccupancy ?? 0) > 0

  const [number, setNumber] = useState('')
  const [roomTypeId, setRoomTypeId] = useState('')
  const [gender, setGender] = useState<'M' | 'F' | ''>('')
  const [capacity, setCapacity] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Populate fields when opening in edit mode
  useEffect(() => {
    if (open && editRoom) {
      setNumber(editRoom.number)
      setRoomTypeId(editRoom.roomTypeId)
      setGender(editRoom.gender)
      setCapacity(String(editRoom.capacity))
      setNotes(editRoom.notes ?? '')
      setError('')
    } else if (open) {
      setNumber('')
      setRoomTypeId('')
      setGender('')
      setCapacity('')
      setNotes('')
      setError('')
    }
  }, [open, editRoom])

  const selectedType = roomTypes.find((rt) => rt.id === roomTypeId)

  function validate(): string | null {
    if (!number.trim()) return 'Room number is required'
    if (!roomTypeId) return 'Room type is required'
    if (!gender) return 'Gender is required'
    const capNum = capacity === '' ? null : Number(capacity)
    if (capNum !== null && (isNaN(capNum) || capNum < 1)) return 'Capacity must be a positive number'

    // Uniqueness: number must be unique within campId + gender
    const isDuplicate = existingRooms.some((r) => {
      if (isEdit && r.id === editRoom?.id) return false
      return r.number.toLowerCase() === number.trim().toLowerCase() && r.gender === gender
    })
    if (isDuplicate) return `Room ${number.trim()} (${gender}) already exists`

    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }

    const uid = auth.currentUser!.uid
    const selectedTypeName = selectedType?.name ?? ''
    const resolvedCapacity = capacity === '' ? (selectedType?.defaultCapacity ?? 1) : Number(capacity)

    setSaving(true)
    setError('')
    try {
      if (isEdit && editRoom) {
        await updateRoom(
          campId,
          editRoom.id,
          {
            roomTypeId,
            roomTypeName: selectedTypeName,
            capacity: resolvedCapacity,
            notes: notes.trim() || deleteField(),
            // number and gender are locked if occupied; only update if not locked
            ...(locked ? {} : { number: number.trim(), gender: gender as 'M' | 'F' }),
          },
          uid,
        )
      } else {
        await createRoom(
          campId,
          {
            number: number.trim(),
            roomTypeId,
            roomTypeName: selectedTypeName,
            gender: gender as 'M' | 'F',
            capacity: resolvedCapacity,
            notes: notes.trim() || undefined,
          },
          uid,
        )
      }
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit room' : 'Add room'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="room-number">Room number</Label>
              <Input
                id="room-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="204"
                disabled={locked}
              />
              {locked && (
                <p className="text-xs text-muted-foreground">Locked — room has occupants</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select
                value={gender}
                onValueChange={(v) => setGender(v as 'M' | 'F')}
                disabled={locked}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">Male (M)</SelectItem>
                  <SelectItem value="F">Female (F)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Room type</Label>
            <Select value={roomTypeId} onValueChange={setRoomTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map((rt) => (
                  <SelectItem key={rt.id} value={rt.id}>
                    {rt.name} (cap {rt.defaultCapacity})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="room-capacity">
              Capacity{selectedType && <span className="text-muted-foreground"> (default: {selectedType.defaultCapacity})</span>}
            </Label>
            <Input
              id="room-capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder={selectedType ? String(selectedType.defaultCapacity) : 'Leave blank for type default'}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="room-notes">Notes (optional)</Label>
            <Textarea
              id="room-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Ground floor, near bathroom"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add room'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
