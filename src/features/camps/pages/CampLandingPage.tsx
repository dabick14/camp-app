import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, DoorOpen, Settings, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDateRange } from '@/lib/dates'
import { getCamp } from '../services/campService'
import type { Camp } from '../types'

export function CampLandingPage() {
  const { id } = useParams<{ id: string }>()
  const [camp, setCamp] = useState<Camp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getCamp(id)
      .then((data) => {
        if (cancelled) return
        if (!data) setError('Camp not found.')
        else setCamp(data)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) { setError('Failed to load camp.'); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (error || !camp) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-destructive">{error || 'Camp not found.'}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        to="/admin/camps"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All camps
      </Link>

      {camp.imageUrl && (
        <img
          src={camp.imageUrl}
          alt=""
          className="mb-6 h-48 w-full rounded-lg object-cover"
        />
      )}

      <div className="flex flex-wrap items-start gap-3">
        <h1 className="text-3xl font-semibold">{camp.name}</h1>
        <Badge variant={camp.registrationOpen ? 'default' : 'secondary'} className="mt-1.5">
          {camp.registrationOpen ? 'Registration open' : 'Registration closed'}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{camp.location}</span>
        <span>{formatDateRange(camp.startDate, camp.endDate)}</span>
        {(camp.minAge != null || camp.maxAge != null) && (
          <span>
            Ages {camp.minAge ?? '?'}–{camp.maxAge ?? '?'}
          </span>
        )}
        {camp.maxParticipants != null && (
          <span>Max {camp.maxParticipants} participants</span>
        )}
      </div>

      {camp.description && (
        <p className="mt-4 text-sm leading-relaxed text-foreground">{camp.description}</p>
      )}

      <Separator className="my-6" />

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to={`/admin/camps/${camp.id}/settings`}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/admin/camps/${camp.id}/rooms`}>
            <DoorOpen className="mr-2 h-4 w-4" />
            Rooms
          </Link>
        </Button>
        <Button asChild variant="outline" disabled>
          <Link to={`/admin/camps/${camp.id}/participants`}>
            <Users className="mr-2 h-4 w-4" />
            Participants
          </Link>
        </Button>
      </div>
    </div>
  )
}
