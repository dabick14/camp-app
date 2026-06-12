import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, PlusIcon, Trash2, UploadIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getCamp } from '@/features/camps/services/campService'
import type { Camp } from '@/features/camps/types'
import { CsvImportModal } from '../components/CsvImportModal'
import { RoomFormModal } from '../components/RoomFormModal'
import { deleteRoom, listRooms } from '../services/roomService'
import { listRoomTypes } from '../services/roomTypeService'
import type { Room, RoomType } from '../types'

function naturalSort(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) =>
    a.number.localeCompare(b.number, undefined, { numeric: true }),
  )
}

export function RoomsPage() {
  const { id: campId } = useParams<{ id: string }>()

  const [camp, setCamp] = useState<Camp | null>(null)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filterTypeId, setFilterTypeId] = useState('all')
  const [filterGender, setFilterGender] = useState('all')

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editRoom, setEditRoom] = useState<Room | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)

  useEffect(() => {
    if (!campId) return
    let cancelled = false
    Promise.all([getCamp(campId), listRoomTypes(campId), listRooms(campId)])
      .then(([campData, types, roomsData]) => {
        if (cancelled) return
        setCamp(campData)
        setRoomTypes(types)
        setRooms(roomsData)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) { setError('Failed to load rooms.'); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [campId])

  async function refreshRooms() {
    if (!campId) return
    const data = await listRooms(campId)
    setRooms(data)
  }

  async function handleDelete(room: Room) {
    if (room.currentOccupancy > 0) return
    if (!confirm(`Delete room ${room.number}?`)) return
    await deleteRoom(campId!, room.id)
    setRooms((prev) => prev.filter((r) => r.id !== room.id))
  }

  const filtered = useMemo(() => {
    let result = naturalSort(rooms)
    if (filterTypeId !== 'all') result = result.filter((r) => r.roomTypeId === filterTypeId)
    if (filterGender !== 'all') result = result.filter((r) => r.gender === filterGender)
    return result
  }, [rooms, filterTypeId, filterGender])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* breadcrumb */}
      <Link
        to={`/admin/camps/${campId}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {camp?.name ?? 'Camp'}
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Rooms</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportModalOpen(true)}>
            <UploadIcon className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
          <Button onClick={() => { setEditRoom(null); setAddModalOpen(true) }}>
            <PlusIcon className="mr-2 h-4 w-4" />
            Add room
          </Button>
        </div>
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={filterTypeId} onValueChange={setFilterTypeId}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {roomTypes.map((rt) => (
              <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterGender} onValueChange={setFilterGender}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All genders</SelectItem>
            <SelectItem value="M">Male (M)</SelectItem>
            <SelectItem value="F">Female (F)</SelectItem>
          </SelectContent>
        </Select>

        {(filterTypeId !== 'all' || filterGender !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterTypeId('all'); setFilterGender('all') }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* summary */}
      <p className="mb-3 text-sm text-muted-foreground">
        {filtered.length} room{filtered.length !== 1 ? 's' : ''}
        {rooms.length !== filtered.length && ` (${rooms.length} total)`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No rooms yet.</p>
          {roomTypes.length === 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Add room types first in{' '}
              <Link to={`/admin/camps/${campId}/settings`} className="underline">
                Camp settings
              </Link>
              .
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-20">Gender</TableHead>
                <TableHead className="w-24">Capacity</TableHead>
                <TableHead className="w-24">Occupancy</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((room) => (
                <TableRow key={room.id}>
                  <TableCell className="font-mono font-medium">{room.number}</TableCell>
                  <TableCell>{room.roomTypeName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{room.gender}</Badge>
                  </TableCell>
                  <TableCell>{room.capacity}</TableCell>
                  <TableCell>
                    <span
                      className={
                        room.currentOccupancy >= room.capacity
                          ? 'font-medium text-amber-600'
                          : 'text-muted-foreground'
                      }
                    >
                      {room.currentOccupancy}/{room.capacity}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {room.notes ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setEditRoom(room)}
                      >
                        Edit
                      </Button>

                      {room.currentOccupancy > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 cursor-not-allowed p-0 text-muted-foreground"
                                disabled
                                aria-label="Delete room"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Unassign participants first</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(room)}
                          aria-label="Delete room"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RoomFormModal
        open={addModalOpen || Boolean(editRoom)}
        onOpenChange={(v) => {
          if (!v) { setAddModalOpen(false); setEditRoom(null) }
        }}
        campId={campId!}
        roomTypes={roomTypes}
        existingRooms={rooms}
        editRoom={editRoom}
        onSaved={refreshRooms}
      />

      <CsvImportModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        campId={campId!}
        roomTypes={roomTypes}
        existingRooms={rooms}
        onImported={refreshRooms}
      />
    </div>
  )
}
