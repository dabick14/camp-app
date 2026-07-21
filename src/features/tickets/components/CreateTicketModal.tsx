import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, Camera, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ImageAttachments } from '@/components/ImageAttachments'
import { createTicket, getTicket, removeTicketImage, uploadTicketImage } from '../services/ticketService'
import type { TicketImage } from '../types'
import type { Room } from '@/features/rooms/types'

interface CreateTicketModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campId: string
  rooms: Room[]
  uid: string
  /** Pre-selects a room and skips the picker — the "log issue" shortcut from a room row. */
  initialRoomId?: string
  onCreated: () => void
}

interface StagedPhoto {
  id: string
  file: File
  previewUrl: string
}

function naturalSort(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
}

export function CreateTicketModal({
  open,
  onOpenChange,
  campId,
  rooms,
  uid,
  initialRoomId,
  onCreated,
}: CreateTicketModalProps) {
  const [search, setSearch] = useState('')
  const [roomId, setRoomId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingLabel, setSavingLabel] = useState('Logging…')

  // Photos picked in the form itself, staged locally (not yet uploaded —
  // there's no ticketId for the Storage path until the ticket doc exists).
  // Submit creates the ticket, then uploads each staged file through the
  // same shared pipeline the detail page uses for "add more photos later."
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Fallback-only: if a staged upload fails after the ticket is already
  // created, drop into the same "attach photos" view the detail page uses,
  // pre-loaded with whatever succeeded, so the failure is recoverable via
  // the existing retry UI rather than silently losing the photo.
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null)
  const [attachedImages, setAttachedImages] = useState<TicketImage[]>([])

  useEffect(() => {
    if (open) {
      setSearch('')
      setRoomId(initialRoomId ?? '')
      setTitle('')
      setDescription('')
      setError('')
      setCreatedTicketId(null)
      setAttachedImages([])
      setStagedPhotos((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.previewUrl))
        return []
      })
    }
  }, [open, initialRoomId])

  const sortedRooms = useMemo(() => naturalSort(rooms), [rooms])
  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sortedRooms
    return sortedRooms.filter(
      (r) => r.number.toLowerCase().includes(q) || r.roomTypeName.toLowerCase().includes(q),
    )
  }, [sortedRooms, search])

  const selectedRoom = rooms.find((r) => r.id === roomId)

  function handlePhotosSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const added = Array.from(fileList).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setStagedPhotos((prev) => [...prev, ...added])
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  function removeStagedPhoto(id: string) {
    setStagedPhotos((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRoom) { setError('Pick a room'); return }
    if (!title.trim()) { setError('Title is required'); return }

    setSaving(true)
    setSavingLabel('Logging…')
    setError('')
    try {
      const ticketId = await createTicket(
        campId,
        {
          roomId: selectedRoom.id,
          roomNumber: selectedRoom.number,
          roomTypeName: selectedRoom.roomTypeName,
          title: title.trim(),
          description: description.trim(),
        },
        uid,
      )
      onCreated()

      if (stagedPhotos.length === 0) {
        onOpenChange(false)
        return
      }

      let failures = 0
      for (let i = 0; i < stagedPhotos.length; i++) {
        setSavingLabel(`Uploading photo ${i + 1}/${stagedPhotos.length}…`)
        try {
          await uploadTicketImage(campId, ticketId, stagedPhotos[i].file, uid)
        } catch {
          failures++
        }
      }
      stagedPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
      setStagedPhotos([])

      if (failures === 0) {
        onOpenChange(false)
      } else {
        // Ticket exists and some photos are attached — don't lose that
        // progress. Fall back to the same attach/retry view the detail
        // page uses so the failed one(s) can be re-added.
        toast.error(
          `Ticket logged, but ${failures} photo${failures !== 1 ? 's' : ''} failed to upload. Add ${failures !== 1 ? 'them' : 'it'} again below.`,
        )
        const t = await getTicket(campId, ticketId)
        setAttachedImages(t?.imageUrls ?? [])
        setCreatedTicketId(ticketId)
      }
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create ticket')
    } finally {
      setSaving(false)
    }
  }

  async function refreshAttachedImages() {
    if (!createdTicketId) return
    const t = await getTicket(campId, createdTicketId)
    setAttachedImages(t?.imageUrls ?? [])
  }

  // Fallback view — only reached if one or more staged photos failed to
  // upload after the ticket was already created (see handleSubmit above).
  if (createdTicketId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add photos</DialogTitle>
          </DialogHeader>
          <DialogBody className="pt-2">
            <p className="mb-4 text-sm text-muted-foreground">
              Ticket logged. Some photos didn't make it — attach them again, or skip and add them later.
            </p>
            <ImageAttachments
              images={attachedImages}
              onUpload={(file, onProgress) => uploadTicketImage(campId, createdTicketId, file, uid, onProgress)}
              onRemove={(image) => removeTicketImage(campId, createdTicketId, image, uid)}
              onChange={refreshAttachedImages}
              addLabel="Add photo"
              altText="Ticket photo"
              emptyMessage="No photos yet."
              removeConfirmMessage="Remove this photo? This cannot be undone."
            />
          </DialogBody>
          <DialogFooter>
            <Button className="min-h-11 w-full sm:min-h-9 sm:w-auto" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log an issue</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="contents">
        <DialogBody className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Room</Label>
            {selectedRoom && !initialRoomId ? (
              <div className="flex min-h-11 items-center justify-between rounded-lg border bg-muted/40 px-3">
                <span className="text-sm">{selectedRoom.number} · {selectedRoom.roomTypeName}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRoomId('')}>
                  Change
                </Button>
              </div>
            ) : initialRoomId && selectedRoom ? (
              <div className="flex min-h-11 items-center rounded-lg border bg-muted/40 px-3 text-sm">
                {selectedRoom.number} · {selectedRoom.roomTypeName}
              </div>
            ) : (
              <>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search room number or type…"
                />
                <div className="max-h-48 overflow-y-auto rounded-lg border">
                  {filteredRooms.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">No rooms match.</p>
                  ) : (
                    <div className="divide-y">
                      {filteredRooms.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRoomId(r.id)}
                          className={cn(
                            'flex min-h-11 w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60',
                            roomId === r.id && 'bg-primary/5',
                          )}
                        >
                          <span>{r.number} · {r.roomTypeName}</span>
                          {roomId === r.id && <CheckIcon className="h-4 w-4 shrink-0 text-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-title">Title</Label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Leaking tap in bathroom"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-description">Description</Label>
            <Textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What's wrong, how bad, anything facilities should know…"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Photos (optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 whitespace-normal sm:h-7 sm:whitespace-nowrap"
                onClick={() => photoInputRef.current?.click()}
              >
                <Camera className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                Add photo
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handlePhotosSelected(e.target.files)}
              />
            </div>
            {stagedPhotos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 pt-1">
                {stagedPhotos.map((p) => (
                  <div
                    key={p.id}
                    className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removeStagedPhoto(p.id)}
                      disabled={saving}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-100 transition-opacity disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="min-h-11 whitespace-normal sm:min-h-9 sm:whitespace-nowrap">
            {saving ? savingLabel : 'Log issue'}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
