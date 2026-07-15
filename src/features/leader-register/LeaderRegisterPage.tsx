import { useEffect, useRef, useState } from 'react'
import { type Resolver, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { BookOpen, ClipboardList, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney } from '@/lib/formatMoney'
import { withTimeout } from '@/lib/withTimeout'
import { functions } from '@/lib/firebase'
import { getCamp } from '@/features/camps/services/campService'
import { listRoomTypes } from '@/features/rooms/services/roomTypeService'
import { isSubGroupGated } from '@/features/payments/services/batchService'
import type { Camp } from '@/features/camps/types'
import type { RoomType } from '@/features/rooms/types'
import { useUserRole } from '@/features/auth/UserRoleContext'
import { LogoutButton } from '@/features/auth/LogoutButton'
import {
  isValidGhanaPhone,
  normalizePhone,
  computeAgeFromDob,
} from '@/features/registration/utils'

interface LeaderRegisterResult {
  participantId: string
  fullName: string
  subGroupName: string
  roomTypePreferenceName: string
  feeOwed: number
  currency: string
  campName: string
}

// Callable — auth token attachment, CORS, and the 15s timeout are all
// handled by the SDK; no manual fetch/Bearer-token/AbortController needed.
const leaderRegisterParticipant = httpsCallable<Record<string, unknown>, LeaderRegisterResult>(
  functions,
  'leaderRegisterParticipant',
  { timeout: 15_000 },
)

// ─── schema — identical to the public form, minus subGroupId ──────────────────

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
  gender: z.string().refine((v) => v === 'M' || v === 'F', 'Please select a gender'),
  dateOfBirth: z.string().optional(),
  age: z.string().optional(),
  roomTypePreferenceId: z.string().min(1, 'Please select a room type'),
})

type Schema = {
  fullName: string
  phone: string
  email: string
  gender: 'M' | 'F' | ''
  dateOfBirth: string
  age: string
  roomTypePreferenceId: string
}

const defaultValues: Schema = {
  fullName: '', phone: '', email: '', gender: '',
  dateOfBirth: '', age: '', roomTypePreferenceId: '',
}

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

type PageStatus = 'loading' | 'open' | 'closed' | 'gated' | 'error'

export function LeaderRegisterPage() {
  const role = useUserRole()

  const [pageStatus, setPageStatus] = useState<PageStatus>('loading')
  const [camp, setCamp] = useState<Camp | null>(null)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])

  const [useDob, setUseDob] = useState(true)
  const [submitError, setSubmitError] = useState('')

  // Same mobile fix as the public form — scroll focused input into view once
  // the on-screen keyboard has appeared.
  function scrollToFocused(e: React.FocusEvent<HTMLElement>) {
    const el = e.target
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
  }

  const [softDup, setSoftDup] = useState<{ type: string; message: string } | null>(null)
  const acknowledgedDupsRef = useRef<string[]>([])

  const campId = role.type === 'leader' ? role.campId : null

  const subGroupId = role.type === 'leader' ? role.subGroupId : null

  useEffect(() => {
    if (!campId || !subGroupId) return
    let cancelled = false

    withTimeout(
      Promise.all([getCamp(campId), listRoomTypes(campId), isSubGroupGated(campId, subGroupId)]),
    )
      .then(([campData, types, gated]) => {
        if (cancelled) return
        if (!campData) { setPageStatus('error'); return }
        if (!campData.registrationOpen) { setPageStatus('closed'); return }
        setCamp(campData)
        if (gated) { setPageStatus('gated'); return }
        setRoomTypes(types)
        setPageStatus('open')
      })
      .catch(() => {
        if (!cancelled) setPageStatus('error')
      })

    return () => { cancelled = true }
  }, [campId, subGroupId])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Schema>({
    resolver: zodResolver(schema) as Resolver<Schema>,
    mode: 'onTouched',
    defaultValues,
  })

  const gender = watch('gender')
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
        message: `This camp has a minimum age of ${camp.minAge}.`,
      })
    } else if (camp.maxAge != null && computedAge > camp.maxAge) {
      setError(field, {
        type: 'manual',
        message: `This camp has a maximum age of ${camp.maxAge}.`,
      })
    } else {
      clearErrors([field])
    }
  }, [watchedDob, watchedAge, useDob, camp])

  async function onSubmit(values: Schema) {
    setSubmitError('')
    setSoftDup(null)

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
          setError(field, { type: 'manual', message: `This camp has a minimum age of ${camp.minAge}.` })
          return
        }
        if (camp.maxAge != null && computedAge > camp.maxAge) {
          setError(field, { type: 'manual', message: `This camp has a maximum age of ${camp.maxAge}.` })
          return
        }
      }
    }

    try {
      // campId / subGroupId are NOT sent — the function derives them
      // server-side from the caller's own leader doc.
      const payload: Record<string, unknown> = {
        fullName: values.fullName.trim(),
        phone: normalizePhone(values.phone),
        gender: values.gender,
        roomTypePreferenceId: values.roomTypePreferenceId,
        acknowledgedDuplicates: acknowledgedDupsRef.current,
      }
      if (values.email?.trim()) payload.email = values.email.trim()
      if (useDob && values.dateOfBirth) payload.dateOfBirth = values.dateOfBirth
      if (!useDob && values.age) payload.age = parseInt(values.age, 10)

      const result = await leaderRegisterParticipant(payload)
      const data = result.data

      toast.success(
        `${data.fullName} registered — fee owed: ${formatMoney(data.feeOwed, data.currency)}`,
      )
      acknowledgedDupsRef.current = []
      reset(defaultValues)
      setUseDob(true)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      const detailsError = (err as { details?: { error?: string } })?.details?.error

      if (detailsError === 'DUPLICATE_NAME_DOB' || detailsError === 'DUPLICATE_EMAIL') {
        setSoftDup({ type: detailsError, message: (err as Error).message })
        return
      }

      const isConnectError = code === 'functions/deadline-exceeded' || code === 'functions/unavailable'
      setSubmitError(
        isConnectError
          ? "⚠️ Couldn't connect. Check your internet connection and try again."
          : ((err as { message?: string })?.message ?? 'Submission failed. Please try again.'),
      )
    }
  }

  function acknowledgeAndResubmit() {
    if (!softDup) return
    acknowledgedDupsRef.current = [...acknowledgedDupsRef.current, softDup.type]
    setSoftDup(null)
    handleSubmit(onSubmit)()
  }

  if (role.type !== 'leader') return null // ProtectedRoute guarantees this; narrows for TS

  if (pageStatus === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (pageStatus === 'closed') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-lg font-medium">Registration is closed</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Registration for this camp is not currently open. Contact the camp administrator.
        </p>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    )
  }

  if (pageStatus === 'gated') {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold">{camp?.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{camp?.location}</p>
          </div>
          <LogoutButton />
        </div>

        {/* Nav between leader screens — the roster stays reachable while gated */}
        <div className="mb-6 flex gap-2 border-b pb-4">
          <span className="flex items-center gap-1.5 rounded-md bg-brand-tint px-3 py-3.5 text-sm font-medium text-primary">
            <UserPlus className="h-4 w-4" />
            Register
          </span>
          <Link
            to="/leader/roster"
            className="flex items-center gap-1.5 rounded-md px-3 py-3.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <ClipboardList className="h-4 w-4" />
            Payment roster
          </Link>
          <Link
            to="/guide"
            className="flex items-center gap-1.5 rounded-md px-3 py-3.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <BookOpen className="h-4 w-4" />
            Guide
          </Link>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-lg font-medium text-amber-900">New registrations are paused</p>
          <p className="mt-2 text-sm text-amber-800">
            {role.subGroupName} has a payment batch that hasn't been fully reconciled yet, so new
            registrations are on hold until your admin reconciles it. You can still mark who has
            paid — that's how the batch gets resolved.
          </p>
          <div className="mt-4">
            <Button asChild size="xl">
              <Link to="/leader/roster">
                <ClipboardList className="h-4 w-4" />
                Go to payment roster
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (pageStatus === 'error') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm text-destructive">Failed to load the registration form. Please try again.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">{camp?.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{camp?.location}</p>
        </div>
        <LogoutButton />
      </div>

      {/* Nav between leader screens */}
      <div className="mb-6 flex gap-2 border-b pb-4">
        <span className="flex items-center gap-1.5 rounded-md bg-brand-tint px-3 py-3.5 text-sm font-medium text-primary">
          <UserPlus className="h-4 w-4" />
          Register
        </span>
        <Link
          to="/leader/roster"
          className="flex items-center gap-1.5 rounded-md px-3 py-3.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <ClipboardList className="h-4 w-4" />
          Payment roster
        </Link>
        <Link
          to="/guide"
          className="flex items-center gap-1.5 rounded-md px-3 py-3.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <BookOpen className="h-4 w-4" />
          Guide
        </Link>
      </div>

      <div className="mb-6 rounded-md border bg-muted/40 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Registering into
        </p>
        <p className="text-lg font-semibold">{role.subGroupName}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>

        <Field label="Full name" required error={errors.fullName?.message}>
          <Input {...register('fullName')} placeholder="John Doe" autoComplete="name" onFocus={scrollToFocused} className="h-11" />
        </Field>

        <Field label="Phone number" required error={errors.phone?.message}>
          <Input
            {...register('phone')}
            placeholder="0244 123 456"
            inputMode="tel"
            autoComplete="tel"
            onFocus={scrollToFocused}
            className="h-11"
          />
        </Field>

        <Field label="Email" optional error={errors.email?.message}>
          <Input
            {...register('email')}
            placeholder="you@example.com"
            inputMode="email"
            autoComplete="email"
            onFocus={scrollToFocused}
            className="h-11"
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
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border py-4 text-sm font-medium transition-colors ${
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
              {useDob ? 'Only know the age' : 'Know the date of birth'}
            </button>
          </div>
          {useDob ? (
            <Input type="date" {...register('dateOfBirth')} onFocus={scrollToFocused} className="h-11" />
          ) : (
            <Input
              type="number"
              min={1}
              max={120}
              inputMode="numeric"
              placeholder="e.g. 22"
              {...register('age')}
              onFocus={scrollToFocused}
              className="h-11"
            />
          )}
          {useDob && errors.dateOfBirth && (
            <p className="text-sm text-destructive">{errors.dateOfBirth.message}</p>
          )}
          {!useDob && errors.age && (
            <p className="text-sm text-destructive">{errors.age.message}</p>
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
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-4 text-sm transition-colors ${
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
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="xl"
                variant="outline"
                onClick={acknowledgeAndResubmit}
                className="border-amber-300 text-amber-800 hover:bg-amber-100"
                disabled={isSubmitting}
              >
                Register anyway
              </Button>
              <Button
                type="button"
                size="xl"
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

        <Button type="submit" size="xl" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Register'}
        </Button>
      </form>
    </div>
  )
}
