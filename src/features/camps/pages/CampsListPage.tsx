import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PlusIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateRange } from '@/lib/dates'
import { listCamps } from '../services/campService'
import type { Camp } from '../types'

export function CampsListPage() {
  const [camps, setCamps] = useState<Camp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    listCamps()
      .then((data) => { if (!cancelled) { setCamps(data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Failed to load camps.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Camps</h1>
        <Button asChild>
          <Link to="/admin/camps/new">
            <PlusIcon className="mr-2 h-4 w-4" />
            New camp
          </Link>
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && camps.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No camps yet.</p>
          <Button asChild className="mt-4">
            <Link to="/admin/camps/new">Create your first camp</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {camps.map((camp) => (
          <Link key={camp.id} to={`/admin/camps/${camp.id}`} className="group block">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              {camp.imageUrl && (
                <img
                  src={camp.imageUrl}
                  alt=""
                  className="h-36 w-full rounded-t-lg object-cover"
                />
              )}
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug">{camp.name}</CardTitle>
                  <Badge variant={camp.registrationOpen ? 'default' : 'secondary'} className="shrink-0">
                    {camp.registrationOpen ? 'Open' : 'Closed'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>{camp.location}</p>
                <p>{formatDateRange(camp.startDate, camp.endDate)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
