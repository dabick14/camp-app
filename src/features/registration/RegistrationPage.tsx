import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { type Resolver, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { functions } from '@/lib/firebase'
import { getCamp } from '@/features/camps/services/campService'
import { listSubGroups } from '@/features/camps/services/subGroupService'
import { listRoomTypes } from '@/features/rooms/services/roomTypeService'
import type { Camp } from '@/features/camps/types'
import type { SubGroup } from '@/features/camps/types'
import type { RoomType } from '@/features/rooms/types'

// ─── schema ──────────────────────────────────────────────────────────────────

const schema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  phone: z
    .string()
    .min(1, 'Phone is required')
    .regex(/^[+\d][\d\s\-(). ]{7,}$/, 'Enter a valid phone number'),
  email: z.string().optional(),
  gender: z.enum(['M', 'F'], { error: 'Gender is required' }),
  dateOfBirth: z.string().optional(),
  age: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  subGroupId: z.string().min(1, 'Please select a sub-group'),
  roomTypePreferenceId: z.string().min(1, 'Please select a room type'),
})

type Schema = {
  fullName: string
  phone: string
  email: string
  gender: 'M' | 'F' | ''
  dateOfBirth: string
  age: string
  emergencyContactName: string
  emergencyContactPhone: string
  subGroupId: string
  roomTypePreferenceId: string
}

// ─── helper components ────────────────────────────────────────────────────────

function Field({
  label,
  optional,
  error,
  children,
}: {
  label: string
  optional?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {optional && <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type PageStatus = 'loading' | 'open' | 'closed' | 'notFound' | 'error'

export function RegistrationPage() {
  const { campId } = useParams<{ campId: string }>()
  const navigate = useNavigate()

  const [pageStatus, setPageStatus] = useState<PageStatus>('loading')
  const [camp, setCamp] = useState<Camp | null>(null)
  const [subGroups, setSubGroups] = useState<SubGroup[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])

  const [useDob, setUseDob] = useState(true)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!campId) { setPageStatus('notFound'); return }
    let cancelled = false

    Promise.all([
      getCamp(campId),
      listSubGroups(campId),
      listRoomTypes(campId),
    ])
      .then(([campData, groups, types]) => {
        if (cancelled) return
        if (!campData) { setPageStatus('notFound'); return }
        setCamp(campData)
        setSubGroups(groups)
        setRoomTypes(types)
        setPageStatus('open')
      })
      .catch((err: { code?: string }) => {
        if (cancelled) return
        if (err?.code === 'permission-denied') {
          setPageStatus('closed')
        } else {
          setPageStatus('error')
        }
      })

    return () => { cancelled = true }
  }, [campId])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Schema>({
    resolver: zodResolver(schema) as Resolver<Schema>,
    defaultValues: {
      fullName: '', phone: '', email: '', gender: '',
      dateOfBirth: '', age: '',
      emergencyContactName: '', emergencyContactPhone: '',
      subGroupId: '', roomTypePreferenceId: '',
    },
  })

  const gender = watch('gender')
  const selectedSubGroupId = watch('subGroupId')
  const selectedRoomTypeId = watch('roomTypePreferenceId')

  async function onSubmit(values: Schema) {
    setSubmitError('')
    try {
      const fn = httpsCallable(functions, 'registerParticipant')
      const payload: Record<string, unknown> = {
        campId,
        fullName: values.fullName,
        phone: values.phone,
        gender: values.gender,
        subGroupId: values.subGroupId,
        roomTypePreferenceId: values.roomTypePreferenceId,
      }
      if (values.email?.trim()) payload.email = values.email.trim()
      if (useDob && values.dateOfBirth) payload.dateOfBirth = values.dateOfBirth
      if (!useDob && values.age) payload.age = parseInt(values.age, 10)
      if (values.emergencyContactName?.trim()) payload.emergencyContactName = values.emergencyContactName.trim()
      if (values.emergencyContactPhone?.trim()) payload.emergencyContactPhone = values.emergencyContactPhone.trim()

      const result = await fn(payload)
      const data = result.data as {
        participantId: string
        fullName: string
        subGroupName: string
        roomTypePreferenceName: string
        feeOwed: number
        currency: string
        campName: string
      }

      navigate(`/r/${campId}/done`, {
        state: {
          participantId: data.participantId,
          fullName: data.fullName,
          subGroupName: data.subGroupName,
          roomTypePreferenceName: data.roomTypePreferenceName,
          feeOwed: data.feeOwed,
          currency: data.currency,
          campName: data.campName,
        },
      })
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message ?? 'Submission failed. Please try again.'
      setSubmitError(message)
    }
  }

  // ─── render states ───────────────────────────────────────────────────────

  if (pageStatus === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (pageStatus === 'notFound') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-lg font-medium">Camp not found</p>
        <p className="mt-1 text-sm text-muted-foreground">This registration link may be incorrect.</p>
      </div>
    )
  }

  if (pageStatus === 'closed') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-lg font-medium">Registration is closed</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Registration for this camp is not currently open. Contact your group leader for details.
        </p>
      </div>
    )
  }

  if (pageStatus === 'error') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm text-destructive">Failed to load registration form. Please try again.</p>
      </div>
    )
  }

  // ─── form ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{camp?.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {camp?.location}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

        {/* Personal details */}
        <Field label="Full name" error={errors.fullName?.message}>
          <Input {...register('fullName')} placeholder="John Doe" autoComplete="name" />
        </Field>

        <Field label="Phone number" error={errors.phone?.message}>
          <Input {...register('phone')} placeholder="0244 000 000" inputMode="tel" autoComplete="tel" />
        </Field>

        <Field label="Email" optional error={errors.email?.message}>
          <Input {...register('email')} placeholder="you@example.com" inputMode="email" autoComplete="email" />
        </Field>

        {/* Gender */}
        <div className="space-y-1.5">
          <Label>Gender</Label>
          <div className="flex gap-3">
            {(['M', 'F'] as const).map((g) => (
              <label
                key={g}
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border py-2.5 text-sm font-medium transition-colors ${
                  gender === g
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-muted'
                }`}
              >
                <input
                  type="radio"
                  value={g}
                  className="sr-only"
                  {...register('gender')}
                />
                {g === 'M' ? 'Male' : 'Female'}
              </label>
            ))}
          </div>
          {errors.gender && <p className="text-sm text-destructive">{errors.gender.message as string}</p>}
        </div>

        {/* Date of birth / age */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{useDob ? 'Date of birth' : 'Age'}<span className="ml-1 text-xs text-muted-foreground">(optional)</span></Label>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => { setUseDob(!useDob); setValue('dateOfBirth', ''); setValue('age', '') }}
            >
              {useDob ? "I only know my age" : "I know my date of birth"}
            </button>
          </div>
          {useDob ? (
            <Input type="date" {...register('dateOfBirth')} />
          ) : (
            <Input
              type="number"
              min={1}
              max={120}
              inputMode="numeric"
              placeholder="e.g. 22"
              {...register('age')}
            />
          )}
        </div>

        {/* Emergency contact */}
        <Field label="Emergency contact name" optional error={errors.emergencyContactName?.message}>
          <Input {...register('emergencyContactName')} placeholder="Jane Doe" />
        </Field>

        <Field label="Emergency contact phone" optional error={errors.emergencyContactPhone?.message}>
          <Input {...register('emergencyContactPhone')} placeholder="0244 000 000" inputMode="tel" />
        </Field>

        {/* Sub-group */}
        <div className="space-y-1.5">
          <Label>Sub-group</Label>
          <div className="space-y-2">
            {subGroups.map((sg) => (
              <label
                key={sg.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors ${
                  selectedSubGroupId === sg.id
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-muted'
                }`}
              >
                <input type="radio" value={sg.id} className="sr-only" {...register('subGroupId')} />
                <span
                  className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                    selectedSubGroupId === sg.id ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`}
                />
                {sg.name}
              </label>
            ))}
          </div>
          {errors.subGroupId && <p className="text-sm text-destructive">{errors.subGroupId.message}</p>}
        </div>

        {/* Room type */}
        <div className="space-y-1.5">
          <Label>Room type preference</Label>
          <div className="space-y-2">
            {roomTypes.map((rt) => (
              <label
                key={rt.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors ${
                  selectedRoomTypeId === rt.id
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-muted'
                }`}
              >
                <input type="radio" value={rt.id} className="sr-only" {...register('roomTypePreferenceId')} />
                <span
                  className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                    selectedRoomTypeId === rt.id ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`}
                />
                <span className="flex-1">{rt.name}</span>
                <span className="text-muted-foreground">
                  {camp?.currency ?? 'GHS'} {rt.price.toLocaleString()}
                </span>
              </label>
            ))}
          </div>
          {errors.roomTypePreferenceId && (
            <p className="text-sm text-destructive">{errors.roomTypePreferenceId.message}</p>
          )}
        </div>

        {submitError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {submitError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Register'}
        </Button>
      </form>
    </div>
  )
}
