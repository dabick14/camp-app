import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { type Resolver, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney } from '@/lib/formatMoney'
import { getCamp } from '@/features/camps/services/campService'
import { listSubGroups } from '@/features/camps/services/subGroupService'
import { listRoomTypes } from '@/features/rooms/services/roomTypeService'
import type { Camp } from '@/features/camps/types'
import type { SubGroup } from '@/features/camps/types'
import type { RoomType } from '@/features/rooms/types'
import {
  isValidGhanaPhone,
  normalizePhone,
  computeAgeFromDob,
} from './utils'

const REGISTER_URL = 'https://us-central1-camp-app-119bb.cloudfunctions.net/registerParticipant'

// ─── schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  phone: z
    .string()
    .min(1, 'Phone number is required')
    .refine(isValidGhanaPhone, 'Enter a valid Ghana number (e.g. 0244 123 456)'),
  email: z.string().refine(
    (v) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    'Enter a valid email address',
  ),
  gender: z.string().refine((v) => v === 'M' || v === 'F', 'Please select your gender'),
  dateOfBirth: z.string().optional(),
  age: z.string().optional(),
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
  subGroupId: string
  roomTypePreferenceId: string
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  optional,
  error,
  children,
}: {
  label: string
  required?: boolean
  optional?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
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

  // Duplicate UX state
  const [softDup, setSoftDup] = useState<{ type: string; message: string } | null>(null)
  const acknowledgedDupsRef = useRef<string[]>([])

  // ─── sub-group combobox state ───────────────────────────────────────────────
  const [sgSearch, setSgSearch] = useState('')
  const [sgOpen, setSgOpen] = useState(false)
  const sgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (sgRef.current && !sgRef.current.contains(e.target as Node)) {
        setSgOpen(false)
        setSgSearch('')
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // ─── load camp data ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!campId) { setPageStatus('notFound'); return }
    let cancelled = false

    Promise.all([getCamp(campId), listSubGroups(campId), listRoomTypes(campId)])
      .then(([campData, groups, types]) => {
        if (cancelled) return
        if (!campData) { setPageStatus('notFound'); return }
        if (!campData.registrationOpen) { setPageStatus('closed'); return }
        setCamp(campData)
        setSubGroups(groups)
        setRoomTypes(types)
        setPageStatus('open')
      })
      .catch((err: { code?: string }) => {
        if (cancelled) return
        setPageStatus(err?.code === 'permission-denied' ? 'closed' : 'error')
      })

    return () => { cancelled = true }
  }, [campId])

  // ─── form ───────────────────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<Schema>({
    resolver: zodResolver(schema) as Resolver<Schema>,
    mode: 'onTouched',
    defaultValues: {
      fullName: '', phone: '', email: '', gender: '',
      dateOfBirth: '', age: '',
      subGroupId: '', roomTypePreferenceId: '',
    },
  })

  const gender = watch('gender')
  const selectedSubGroupId = watch('subGroupId')
  const selectedRoomTypeId = watch('roomTypePreferenceId')
  const watchedDob = watch('dateOfBirth')
  const watchedAge = watch('age')

  // Real-time age gate
  useEffect(() => {
    if (!camp || (camp.minAge == null && camp.maxAge == null)) return
    const field = useDob ? 'dateOfBirth' as const : 'age' as const

    let computedAge: number | null = null
    if (useDob && watchedDob) {
      computedAge = computeAgeFromDob(watchedDob, camp.startDate.toDate())
    } else if (!useDob && watchedAge) {
      const n = parseInt(watchedAge, 10)
      if (!isNaN(n)) computedAge = n
    }

    if (computedAge === null) { clearErrors([field]); return }

    if (camp.minAge != null && computedAge < camp.minAge) {
      setError(field, {
        type: 'manual',
        message: `This camp has a minimum age of ${camp.minAge}. Please contact the organizers if this is an error.`,
      })
    } else if (camp.maxAge != null && computedAge > camp.maxAge) {
      setError(field, {
        type: 'manual',
        message: `This camp has a maximum age of ${camp.maxAge}. Please contact the organizers if this is an error.`,
      })
    } else {
      clearErrors([field])
    }
  }, [watchedDob, watchedAge, useDob, camp])

  const selectedSubGroup = subGroups.find((sg) => sg.id === selectedSubGroupId)
  const filteredSubGroups = subGroups.filter((sg) =>
    sg.name.toLowerCase().includes(sgSearch.toLowerCase()),
  )

  async function onSubmit(values: Schema) {
    setSubmitError('')
    setSoftDup(null)

    // Age gate (submit-time safety net)
    if (camp && (camp.minAge != null || camp.maxAge != null)) {
      let computedAge: number | null = null
      if (useDob && values.dateOfBirth) {
        computedAge = computeAgeFromDob(values.dateOfBirth, camp.startDate.toDate())
      } else if (!useDob && values.age) {
        const n = parseInt(values.age, 10)
        if (!isNaN(n)) computedAge = n
      }
      if (computedAge !== null) {
        const field = useDob ? 'dateOfBirth' as const : 'age' as const
        if (camp.minAge != null && computedAge < camp.minAge) {
          setError(field, { type: 'manual', message: `This camp has a minimum age of ${camp.minAge}. Please contact the organizers if this is an error.` })
          return
        }
        if (camp.maxAge != null && computedAge > camp.maxAge) {
          setError(field, { type: 'manual', message: `This camp has a maximum age of ${camp.maxAge}. Please contact the organizers if this is an error.` })
          return
        }
      }
    }

    try {
      const payload: Record<string, unknown> = {
        campId,
        fullName: values.fullName.trim(),
        phone: normalizePhone(values.phone),
        gender: values.gender,
        subGroupId: values.subGroupId,
        roomTypePreferenceId: values.roomTypePreferenceId,
        acknowledgedDuplicates: acknowledgedDupsRef.current,
      }
      if (values.email?.trim()) payload.email = values.email.trim()
      if (useDob && values.dateOfBirth) payload.dateOfBirth = values.dateOfBirth
      if (!useDob && values.age) payload.age = parseInt(values.age, 10)

      const res = await fetch(REGISTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        if (
          res.status === 409 &&
          (data.error === 'DUPLICATE_NAME_DOB' || data.error === 'DUPLICATE_EMAIL')
        ) {
          setSoftDup({ type: data.error as string, message: data.message })
          return
        }
        throw new Error(data.message ?? data.error ?? 'Registration failed. Please try again.')
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
      setSubmitError((err as { message?: string })?.message ?? 'Submission failed. Please try again.')
    }
  }

  function acknowledgeAndResubmit() {
    if (!softDup) return
    acknowledgedDupsRef.current = [...acknowledgedDupsRef.current, softDup.type]
    setSoftDup(null)
    handleSubmit(onSubmit)()
  }

  // ─── status screens ──────────────────────────────────────────────────────────

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

  // ─── registration form ────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{camp?.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{camp?.location}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>

        <Field label="Full name" required error={errors.fullName?.message}>
          <Input {...register('fullName')} placeholder="John Doe" autoComplete="name" />
        </Field>

        <Field label="Phone number" required error={errors.phone?.message}>
          <Input
            {...register('phone')}
            placeholder="0244 123 456"
            inputMode="tel"
            autoComplete="tel"
          />
        </Field>

        <Field label="Email" optional error={errors.email?.message}>
          <Input
            {...register('email')}
            placeholder="you@example.com"
            inputMode="email"
            autoComplete="email"
          />
        </Field>

        {/* Gender */}
        <div className="space-y-1.5">
          <Label>
            Gender<span className="ml-0.5 text-destructive" aria-hidden>*</span>
          </Label>
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
                <input type="radio" value={g} className="sr-only" {...register('gender')} />
                {g === 'M' ? 'Male' : 'Female'}
              </label>
            ))}
          </div>
          {errors.gender && <p className="text-sm text-destructive">{errors.gender.message}</p>}
        </div>

        {/* Date of birth / age */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>
              {useDob ? 'Date of birth' : 'Age'}
              <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
            </Label>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => {
                setUseDob(!useDob)
                setValue('dateOfBirth', '')
                setValue('age', '')
              }}
            >
              {useDob ? 'I only know my age' : 'I know my date of birth'}
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
          {useDob && errors.dateOfBirth && (
            <p className="text-sm text-destructive">{errors.dateOfBirth.message}</p>
          )}
          {!useDob && errors.age && (
            <p className="text-sm text-destructive">{errors.age.message}</p>
          )}
        </div>

        {/* Sub-group — searchable combobox */}
        <div className="space-y-1.5">
          <Label>
            Sub-group<span className="ml-0.5 text-destructive" aria-hidden>*</span>
          </Label>
          <input type="hidden" {...register('subGroupId')} />
          <div className="relative" ref={sgRef}>
            <button
              type="button"
              aria-expanded={sgOpen}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
                sgOpen ? 'border-ring ring-1 ring-ring/50' : 'border-input'
              } bg-background`}
              onClick={() => setSgOpen(!sgOpen)}
            >
              <span className={selectedSubGroup ? '' : 'text-muted-foreground'}>
                {selectedSubGroup ? selectedSubGroup.name : 'Select your sub-group…'}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>

            {sgOpen && (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-background shadow-lg">
                <div className="border-b p-1.5">
                  <Input
                    autoFocus
                    value={sgSearch}
                    onChange={(e) => setSgSearch(e.target.value)}
                    placeholder="Search…"
                    className="h-8 text-sm"
                  />
                </div>
                <ul className="max-h-52 overflow-y-auto py-1">
                  {filteredSubGroups.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
                  ) : (
                    filteredSubGroups.map((sg) => (
                      <li key={sg.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                          onClick={() => {
                            setValue('subGroupId', sg.id, { shouldTouch: true, shouldValidate: true })
                            setSgOpen(false)
                            setSgSearch('')
                          }}
                        >
                          <span className="w-4 shrink-0">
                            {selectedSubGroupId === sg.id && <Check className="h-3.5 w-3.5" />}
                          </span>
                          {sg.name}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>
          {errors.subGroupId && (
            <p className="text-sm text-destructive">{errors.subGroupId.message}</p>
          )}
        </div>

        {/* Room type — radio cards */}
        <div className="space-y-1.5">
          <Label>
            Room type preference<span className="ml-0.5 text-destructive" aria-hidden>*</span>
          </Label>
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
                <input
                  type="radio"
                  value={rt.id}
                  className="sr-only"
                  {...register('roomTypePreferenceId')}
                />
                <span
                  className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                    selectedRoomTypeId === rt.id ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`}
                />
                <span className="flex-1">{rt.name}</span>
                <span className="text-muted-foreground">
                  {formatMoney(rt.price, camp?.currency ?? 'GHS')}
                </span>
              </label>
            ))}
          </div>
          {errors.roomTypePreferenceId && (
            <p className="text-sm text-destructive">{errors.roomTypePreferenceId.message}</p>
          )}
        </div>

        {/* Soft duplicate warning */}
        {softDup && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="mb-2">{softDup.message}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={acknowledgeAndResubmit}
                className="border-amber-300 text-amber-800 hover:bg-amber-100"
                disabled={isSubmitting}
              >
                Register anyway
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSoftDup(null)}
                className="text-amber-800 hover:bg-amber-100"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

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
