import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import { toast } from 'sonner'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { PageError, PageLoading } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { ImageAttachments } from '@/components/ImageAttachments'
import {
  addTicketNote, getTicket, removeTicketImage, transitionTicketStatus, uploadTicketImage,
} from '../services/ticketService'
import { TICKET_TRANSITIONS } from '../types'
import type { Ticket, TicketStatus } from '../types'
import { TicketStatusBadge } from '../components/TicketStatusBadge'

const TRANSITION_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Reopen — not fixed',
  REPORTED: 'Mark reported',
  FIXED_PENDING_CHECK: 'Mark fixed — pending check',
  CLOSED: 'Close (verified)',
}

function formatDateTime(ts: { toDate(): Date }) {
  return ts.toDate().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function uid() {
  const user = getAuth().currentUser
  return user?.uid ?? 'admin'
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'open',
  REPORTED: 'reported',
  FIXED_PENDING_CHECK: 'fixed — pending check',
  CLOSED: 'closed',
}

export function TicketDetailPage() {
  const { id: campId, ticketId } = useParams<{ id: string; ticketId: string }>()
  const navigate = useNavigate()
  useCampData() // validates we're inside CampLayout

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [working, setWorking] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  const loadTicket = useCallback(async () => {
    if (!campId || !ticketId) return
    setLoading(true)
    setLoadError('')
    try {
      const data = await getTicket(campId, ticketId)
      if (!data) {
        toast.error('Ticket not found')
        navigate(`/admin/camps/${campId}/tickets`)
        return
      }
      setTicket(data)
    } catch (err) {
      setLoadError((err as Error).message ?? 'Failed to load ticket')
    } finally {
      setLoading(false)
    }
  }, [campId, ticketId, navigate])

  useEffect(() => { loadTicket() }, [loadTicket])

  if (loading) return <PageContainer><PageLoading /></PageContainer>
  if (loadError) return (
    <PageContainer><PageError message={loadError} onRetry={loadTicket} /></PageContainer>
  )
  if (!ticket) return null

  async function handleTransition(status: TicketStatus) {
    if (!campId || !ticketId) return
    setWorking(true)
    try {
      await transitionTicketStatus(campId, ticketId, status, uid())
      toast.success(status === 'OPEN' ? 'Ticket reopened' : `Marked ${STATUS_LABEL[status]}`)
      await loadTicket()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed')
    } finally {
      setWorking(false)
    }
  }

  async function handleAddNote() {
    if (!campId || !ticketId || !noteText.trim()) return
    setAddingNote(true)
    try {
      await addTicketNote(campId, ticketId, noteText.trim(), uid())
      setNoteText('')
      await loadTicket()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to add note')
    } finally {
      setAddingNote(false)
    }
  }

  const transitions = TICKET_TRANSITIONS[ticket.status]
  const forwardTransition = transitions.find((s) => s !== 'OPEN')
  const canReopen = transitions.includes('OPEN')

  return (
    <PageContainer>
      <button
        type="button"
        onClick={() => navigate(`/admin/camps/${campId}/tickets`)}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Issues
      </button>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-xl font-semibold">{ticket.title}</h2>
            <TicketStatusBadge status={ticket.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Room {ticket.roomNumber} · {ticket.roomTypeName}
          </p>
          {ticket.description && (
            <p className="mt-2 max-w-prose text-sm">{ticket.description}</p>
          )}
        </div>

        {/* Actions — full-width stacked on mobile, inline on desktop */}
        <div className="grid grid-cols-1 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:items-center">
          {forwardTransition && (
            <Button
              className="min-h-11 w-full whitespace-normal sm:h-8 sm:w-auto sm:min-h-0 sm:whitespace-nowrap"
              onClick={() => handleTransition(forwardTransition)}
              disabled={working}
            >
              {TRANSITION_LABEL[forwardTransition]}
            </Button>
          )}
          {canReopen && (
            <Button
              variant="outline"
              className="min-h-11 w-full whitespace-normal sm:h-8 sm:w-auto sm:min-h-0 sm:whitespace-nowrap"
              onClick={() => handleTransition('OPEN')}
              disabled={working}
            >
              {TRANSITION_LABEL.OPEN}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* Photos — the issue itself at creation, proof-of-fix later */}
      <section className="mt-8">
        <ImageAttachments
          images={ticket.imageUrls ?? []}
          onUpload={(file, onProgress) => uploadTicketImage(campId!, ticketId!, file, uid(), onProgress)}
          onRemove={(image) => removeTicketImage(campId!, ticketId!, image, uid())}
          onChange={loadTicket}
          addLabel="Add photo"
          altText="Ticket photo"
          emptyMessage="No photos attached yet. Attach a photo of the issue — or of the fix, once verified."
          removeConfirmMessage="Remove this photo? This cannot be undone."
        />
      </section>

      <Separator className="mt-8" />

      {/* Status history */}
      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Status history
        </h3>
        <ol className="space-y-3">
          {ticket.statusHistory.map((event, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <TicketStatusBadge status={event.status} />
              <span className="text-muted-foreground">{formatDateTime(event.at)}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Notes */}
      <Separator className="mt-8" />
      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Notes
        </h3>

        {ticket.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {ticket.notes.map((note, i) => (
              <li key={i} className="rounded-md border bg-card px-4 py-3">
                <p className="text-sm">{note.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(note.at)}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 space-y-2">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="e.g. Facilities said Thursday…"
            rows={2}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={handleAddNote}
              disabled={addingNote || !noteText.trim()}
            >
              {addingNote ? 'Adding…' : 'Add note'}
            </Button>
          </div>
        </div>
      </section>
    </PageContainer>
  )
}
