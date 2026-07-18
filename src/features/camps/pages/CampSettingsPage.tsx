import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PageError, PageLoading } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import { auth } from '@/lib/firebase'
import { dateStrToTs, tsToDateStr } from '@/lib/dates'
import { RoomTypesEditor } from '@/features/rooms/components/RoomTypesEditor'
import { CampForm } from '../components/CampForm'
import { SubGroupsEditor } from '../components/SubGroupsEditor'
import { SuperGroupsEditor } from '../components/SuperGroupsEditor'
import { SmsSettingsEditor } from '../components/SmsSettingsEditor'
import { getCamp, updateCamp } from '../services/campService'
import type { Camp, CampFormValues, SmsSettings, SuperGroup } from '../types'
import { PageTitle } from '@/components/ui/page-title'

const SECTIONS = [
  { id: 'general',       label: 'General' },
  { id: 'super-groups',  label: 'Super-groups' },
  { id: 'sub-groups',    label: 'Sub-groups' },
  { id: 'room-types',    label: 'Room types' },
  { id: 'sms',           label: 'SMS' },
] as const

type SectionId = typeof SECTIONS[number]['id']

export function CampSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const [camp, setCamp] = useState<Camp | null>(null)
  const [superGroups, setSuperGroups] = useState<SuperGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [section, setSection] = useState<SectionId>('general')

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
      toast.success('Changes saved.')
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to save changes')
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <PageLoading />
      </PageContainer>
    )
  }

  if (error || !camp) {
    return (
      <PageContainer>
        <PageError message={error || 'Camp not found.'} onRetry={loadCamp} />
      </PageContainer>
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
    <PageContainer>
      <PageTitle className="mb-6">Camp settings</PageTitle>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">

        {/* ── Desktop sidebar ── */}
        <nav className="hidden md:block w-40 shrink-0">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                    section === s.id
                      ? 'bg-brand-tint font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex-1 min-w-0">
          {/* ── Mobile scrollable tab bar ── */}
          <div className="mb-6 overflow-x-auto md:hidden">
            <div className="flex w-max min-w-full gap-1 rounded-lg bg-muted p-1">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                    section === s.id
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Section content ── */}
          {section === 'general' && (
            <CampForm defaultValues={defaultValues} onSubmit={handleSubmit} submitLabel="Save changes" />
          )}
          {section === 'super-groups' && (
            <SuperGroupsEditor campId={id!} superGroups={superGroups} onChange={setSuperGroups} />
          )}
          {section === 'sub-groups' && (
            <SubGroupsEditor campId={id!} campSuperGroups={superGroups} />
          )}
          {section === 'room-types' && (
            <RoomTypesEditor campId={id!} currency={camp.currency ?? 'GHS'} />
          )}
          {section === 'sms' && (
            <SmsSettingsEditor
              campId={id!}
              smsSettings={camp.smsSettings}
              onChange={(updated: SmsSettings) => setCamp({ ...camp, smsSettings: updated })}
            />
          )}
        </div>
      </div>
    </PageContainer>
  )
}
