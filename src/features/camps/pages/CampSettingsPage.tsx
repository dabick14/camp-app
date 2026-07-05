import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { auth } from '@/lib/firebase'
import { dateStrToTs, tsToDateStr } from '@/lib/dates'
import { RoomTypesEditor } from '@/features/rooms/components/RoomTypesEditor'
import { CampForm } from '../components/CampForm'
import { SubGroupsEditor } from '../components/SubGroupsEditor'
import { getCamp, updateCamp } from '../services/campService'
import type { Camp, CampFormValues } from '../types'

export function CampSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const [camp, setCamp] = useState<Camp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

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

  async function handleSubmit(values: CampFormValues) {
    if (!id) return
    const uid = auth.currentUser!.uid
    await updateCamp(
      id,
      {
        name: values.name,
        location: values.location,
        startDate: dateStrToTs(values.startDate),
        endDate: dateStrToTs(values.endDate),
        description: values.description?.trim() || undefined,
        imageUrl: values.imageUrl?.trim() || undefined,
        minAge: values.minAge,
        maxAge: values.maxAge,
        maxParticipants: values.maxParticipants,
        currency: values.currency,
        registrationOpen: values.registrationOpen,
      },
      uid,
    )
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (error || !camp) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-destructive">{error || 'Camp not found.'}</p>
      </div>
    )
  }

  const defaultValues: CampFormValues = {
    name: camp.name,
    location: camp.location,
    startDate: tsToDateStr(camp.startDate),
    endDate: tsToDateStr(camp.endDate),
    description: camp.description ?? '',
    imageUrl: camp.imageUrl ?? '',
    minAge: camp.minAge,
    maxAge: camp.maxAge,
    maxParticipants: camp.maxParticipants,
    currency: camp.currency ?? 'GHS',
    registrationOpen: camp.registrationOpen,
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        to={`/admin/camps/${id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {camp.name}
      </Link>

      <h1 className="mb-6 text-2xl font-semibold">Camp settings</h1>

      <CampForm defaultValues={defaultValues} onSubmit={handleSubmit} submitLabel="Save changes" />

      {saved && <p className="mt-3 text-sm text-emerald-600">Changes saved.</p>}

      <Separator className="my-8" />

      <div>
        <h2 className="mb-4 text-lg font-medium">Sub-groups</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Registrants pick exactly one sub-group. To remove a sub-group, rename it.
        </p>
        <SubGroupsEditor campId={id!} />
      </div>

      <Separator className="my-8" />

      <div>
        <h2 className="mb-4 text-lg font-medium">Room types</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Define types before adding rooms. Capacity here is the default; individual rooms can override it.
        </p>
        <RoomTypesEditor campId={id!} currency={camp.currency ?? 'GHS'} />
      </div>
    </div>
  )
}
