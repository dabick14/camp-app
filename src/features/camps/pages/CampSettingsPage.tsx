import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { PageError, PageLoading } from '@/components/ui/states'
import { Separator } from '@/components/ui/separator'
import { auth } from '@/lib/firebase'
import { dateStrToTs, tsToDateStr } from '@/lib/dates'
import { RoomTypesEditor } from '@/features/rooms/components/RoomTypesEditor'
import { CampForm } from '../components/CampForm'
import { SubGroupsEditor } from '../components/SubGroupsEditor'
import { SuperGroupsEditor } from '../components/SuperGroupsEditor'
import { getCamp, updateCamp } from '../services/campService'
import type { Camp, CampFormValues, SuperGroup } from '../types'

export function CampSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const [camp, setCamp] = useState<Camp | null>(null)
  const [superGroups, setSuperGroups] = useState<SuperGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const loadCamp = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const data = await getCamp(id)
      if (!data) setError('Camp not found.')
      else {
        setCamp(data)
        setSuperGroups(data.superGroups ?? [])
      }
    } catch {
      setError('Failed to load camp.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadCamp() }, [loadCamp])

  async function handleSubmit(values: CampFormValues) {
    if (!id) return
    const uid = auth.currentUser!.uid
    try {
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
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to save changes')
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <PageLoading />
      </div>
    )
  }

  if (error || !camp) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <PageError message={error || 'Camp not found.'} onRetry={loadCamp} />
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
        <h2 className="mb-4 text-lg font-medium">Super-groups</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Optional rollup containers. Define them here, then assign sub-groups below.
          Removing a super-group won't break anything — its sub-groups show as Unassigned in the dashboard.
        </p>
        <SuperGroupsEditor campId={id!} superGroups={superGroups} onChange={setSuperGroups} />
      </div>

      <Separator className="my-8" />

      <div>
        <h2 className="mb-4 text-lg font-medium">Sub-groups</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Registrants pick exactly one sub-group. To remove a sub-group, rename it.
          {superGroups.length > 0 && ' Assign each to a super-group for dashboard rollups.'}
        </p>
        <SubGroupsEditor campId={id!} campSuperGroups={superGroups} />
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
