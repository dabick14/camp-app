import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import { Plus } from 'lucide-react'
import { PageTitle } from '@/components/ui/page-title'
import { PageError, PageLoading, EmptyState } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { formatAge } from '@/lib/dates'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { CreateTicketModal } from '../components/CreateTicketModal'
import { TicketStatusBadge } from '../components/TicketStatusBadge'
import { listTickets } from '../services/ticketService'
import { sortTickets } from '../types'
import type { Ticket, TicketStatus } from '../types'

type StatusFilter = TicketStatus | 'ALL'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'REPORTED', label: 'Reported' },
  { value: 'FIXED_PENDING_CHECK', label: 'Fixed — pending check' },
  { value: 'CLOSED', label: 'Closed' },
]

function uid() {
  const user = getAuth().currentUser
  return user?.uid ?? 'admin'
}

export function TicketsPage() {
  const { id: campId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { rooms } = useCampData()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [showCreate, setShowCreate] = useState(false)

  async function loadTickets() {
    if (!campId) return
    setLoading(true)
    setError('')
    try {
      const data = await listTickets(campId)
      setTickets(data)
    } catch {
      setError('Failed to load tickets.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTickets() }, [campId])

  const filtered = useMemo(() => {
    const list = statusFilter === 'ALL' ? tickets : tickets.filter((t) => t.status === statusFilter)
    return sortTickets(list)
  }, [tickets, statusFilter])

  // Only blank the whole page (and, critically, unmount CreateTicketModal)
  // on the true initial load. Subsequent refreshes — e.g. onCreated firing
  // right after a ticket is created but before its photo uploads finish —
  // must not unmount/remount the open modal mid-flight.
  if (loading && tickets.length === 0) {
    return <PageContainer><PageLoading /></PageContainer>
  }

  if (error) {
    return <PageContainer><PageError message={error} onRetry={loadTickets} /></PageContainer>
  }

  return (
    <PageContainer>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Issues</PageTitle>
        <Button onClick={() => setShowCreate(true)} className="min-h-11 sm:min-h-8">
          <Plus className="mr-1.5 h-4 w-4" />
          Log issue
        </Button>
      </div>

      <div className="mb-4">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={tickets.length === 0 ? 'No issues logged yet.' : 'No issues match this filter.'}
          description={tickets.length === 0 ? 'Log one from here, or from a room in Rooms.' : undefined}
        />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 sm:hidden">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/admin/camps/${campId}/tickets/${t.id}`)}
                className="w-full rounded-lg border bg-card p-4 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm text-muted-foreground">Room {t.roomNumber}</p>
                    <p className="mt-0.5 font-medium">{t.title}</p>
                  </div>
                  <TicketStatusBadge status={t.status} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{formatAge(t.createdAt)}</p>
              </button>
            ))}
          </div>

          {/* Desktop / tablet: table */}
          <div className="hidden overflow-x-auto rounded-md border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Room</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-24">Age</TableHead>
                  <TableHead className="w-44">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => navigate(`/admin/camps/${campId}/tickets/${t.id}`)}
                  >
                    <TableCell className="font-mono font-medium">{t.roomNumber}</TableCell>
                    <TableCell>{t.title}</TableCell>
                    <TableCell className="text-muted-foreground">{formatAge(t.createdAt)}</TableCell>
                    <TableCell><TicketStatusBadge status={t.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <CreateTicketModal
        open={showCreate}
        onOpenChange={setShowCreate}
        campId={campId!}
        rooms={rooms}
        uid={uid()}
        onCreated={loadTickets}
      />
    </PageContainer>
  )
}
