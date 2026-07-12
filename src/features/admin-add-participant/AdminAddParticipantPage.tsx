import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAuth } from 'firebase/auth'
import { Button } from '@/components/ui/button'
import { PageTitle } from '@/components/ui/page-title'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubGroupSelect } from '@/features/camps/components/SubGroupSelect'
import type { SuperGroup } from '@/features/camps/types'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { checkPhoneDuplicate } from '@/features/participants/services/participantService'
import {
  isValidGhanaPhone,
  normalizePhone,
  stripPhone,
} from '@/features/registration/utils'
import { formatMoney } from '@/lib/formatMoney'
import { PageContainer } from '@/components/ui/page-container'

const ADMIN_ADD_URL =
  'https://us-central1-camp-app-119bb.cloudfunctions.net/adminAddParticipant'

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
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
        {optional && (
          <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
        )}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

type SoftDupType = 'DUPLICATE_PHONE' | 'DUPLICATE_NAME_DOB' | 'DUPLICATE_EMAIL'

interface FormErrors {
  fullName?: string
  phone?: string
  email?: string
  gender?: string
  dob?: string
  age?: string
  subGroupId?: string
  roomTypePreferenceId?: string
}

export function AdminAddParticipantPage() {
  const navigate = useNavigate()
  const { id: campId } = useParams<{ id: string }>()
  const { camp, subGroups, roomTypes } = useCampData()
  const superGroups: SuperGroup[] = camp?.superGroups ?? []
  const currency = camp?.currency ?? 'GHS'

  // ─── form state ─────────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [gender, setGender] = useState<'M' | 'F' | ''>('')
  const [useDob, setUseDob] = useState(true)
  const [dob, setDob] = useState('')
  const [age, setAge] = useState('')
  const [subGroupId, setSubGroupId] = useState('')
  const [roomTypePreferenceId, setRoomTypePreferenceId] = useState('')

  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Phone duplicate (blur check)
  const [phoneDupWarning, setPhoneDupWarning] = useState(false)

  // Soft duplicate modal/banner state
  const [softDup, setSoftDup] = useState<{ type: SoftDupType; message: string } | null>(null)
  const acknowledgedDupsRef = useRef<string[]>([])

  // Phone confirmation modal for dup
  const [showPhoneDupModal, setShowPhoneDupModal] = useState(false)
  const [phoneDupMessage, setPhoneDupMessage] = useState('')

  // ─── phone blur check ───────────────────────────────────────────────────────
  async function handlePhoneBlur() {
    if (!campId || !isValidGhanaPhone(phone)) {
      setPhoneDupWarning(false)
      return
    }
    const normalized = normalizePhone(phone)
    const isDup = await checkPhoneDuplicate(campId, normalized)
    setPhoneDupWarning(isDup)
  }

  // Clear phone dup warning when phone changes
  useEffect(() => {
    setPhoneDupWarning(false)
  }, [phone])

  // ─── validation ─────────────────────────────────────────────────────────────
  function validate(): FormErrors {
    const errs: FormErrors = {}
    if (!fullName.trim()) errs.fullName = 'Full name is required'
    if (!phone.trim()) {
      errs.phone = 'Phone number is required'
    } else if (!isValidGhanaPhone(phone)) {
      errs.phone = 'Enter a valid Ghana number (e.g. 0244 123 456)'
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = 'Enter a valid email address'
    }
    if (!gender) errs.gender = 'Please select a gender'
    if (!subGroupId) errs.subGroupId = 'Please select a sub-group'
    if (!roomTypePreferenceId) errs.roomTypePreferenceId = 'Please select a room type'
    if (useDob && dob && isNaN(new Date(dob).getTime())) {
      errs.dob = 'Enter a valid date'
    }
    if (!useDob && age) {
      const n = parseInt(age, 10)
      if (isNaN(n) || n < 0 || n > 150) errs.age = 'Enter a valid age'
    }
    return errs
  }

  // ─── submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSoftDup(null)
    setSubmitError('')

    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})

    const idToken = await getAuth().currentUser?.getIdToken()
    if (!idToken) {
      setSubmitError('Not authenticated. Please refresh and try again.')
      return
    }

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        campId,
        fullName: fullName.trim(),
        phone: normalizePhone(phone),
        gender,
        subGroupId,
        roomTypePreferenceId,
        acknowledgedDuplicates: acknowledgedDupsRef.current,
      }
      if (email.trim()) payload.email = email.trim()
      if (useDob && dob) payload.dateOfBirth = dob
      if (!useDob && age) payload.age = parseInt(age, 10)

      const res = await fetch(ADMIN_ADD_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409 && data.error === 'DUPLICATE_PHONE') {
          setPhoneDupMessage(data.message ?? 'Phone already registered.')
          setShowPhoneDupModal(true)
          return
        }
        if (
          res.status === 409 &&
          (data.error === 'DUPLICATE_NAME_DOB' || data.error === 'DUPLICATE_EMAIL')
        ) {
          setSoftDup({ type: data.error as SoftDupType, message: data.message })
          return
        }
        setSubmitError(data.message ?? data.error ?? 'Failed to add participant.')
        return
      }

      navigate(`/admin/camps/${campId}`, {
        state: { autoOpenId: data.participantId },
      })
    } catch (err: unknown) {
      setSubmitError((err as Error)?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function acknowledgeAndResubmit(type: SoftDupType) {
    acknowledgedDupsRef.current = [...acknowledgedDupsRef.current, type]
    setSoftDup(null)
    // Trigger submit programmatically — use a fake form event-like approach
    const form = document.getElementById('admin-add-form') as HTMLFormElement | null
    form?.requestSubmit()
  }

  function acknowledgePhoneAndResubmit() {
    setShowPhoneDupModal(false)
    acknowledgedDupsRef.current = [...acknowledgedDupsRef.current, 'DUPLICATE_PHONE']
    const form = document.getElementById('admin-add-form') as HTMLFormElement | null
    form?.requestSubmit()
  }

  const selectedRoomType = roomTypes.find((rt) => rt.id === roomTypePreferenceId)

  const normalizedPhone = isValidGhanaPhone(phone) ? normalizePhone(phone) : ''

  return (
    <PageContainer>
      <PageTitle className="mb-6">Add participant</PageTitle>

      <form id="admin-add-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Full name */}
        <Field label="Full name" required error={errors.fullName}>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Abena Mensah"
            autoComplete="off"
          />
        </Field>

        {/* Phone */}
        <Field label="Phone number" required error={errors.phone}>
          <Input
            value={phone}
            onChange={(e) => setPhone(stripPhone(e.target.value))}
            onBlur={handlePhoneBlur}
            placeholder="e.g. 0244 123 456"
            inputMode="tel"
            autoComplete="off"
          />
          {phoneDupWarning && normalizedPhone && (
            <p className="mt-1 text-sm text-amber-700">
              ⚠️ {normalizedPhone} is already registered.
            </p>
          )}
        </Field>

        {/* Email */}
        <Field label="Email" optional error={errors.email}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. abena@example.com"
            autoComplete="off"
          />
        </Field>

        {/* Gender */}
        <Field label="Gender" required error={errors.gender}>
          <div className="flex gap-4">
            {(['M', 'F'] as const).map((g) => (
              <label key={g} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="gender"
                  value={g}
                  checked={gender === g}
                  onChange={() => setGender(g)}
                  className="h-4 w-4"
                />
                {g === 'M' ? 'Male' : 'Female'}
              </label>
            ))}
          </div>
        </Field>

        {/* DOB or Age */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Label>Age</Label>
            <div className="flex rounded-md border border-input overflow-hidden text-xs">
              {[
                { key: true, label: 'Date of birth' },
                { key: false, label: 'Age number' },
              ].map(({ key, label }) => (
                <button
                  key={String(key)}
                  type="button"
                  onClick={() => setUseDob(key)}
                  className={`px-2.5 py-1 transition-colors ${
                    useDob === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">(optional)</span>
          </div>
          {useDob ? (
            <div>
              <Input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="w-48"
              />
              {errors.dob && <p className="mt-1 text-sm text-destructive">{errors.dob}</p>}
            </div>
          ) : (
            <div>
              <Input
                type="number"
                min={0}
                max={150}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 28"
                className="w-28"
              />
              {errors.age && <p className="mt-1 text-sm text-destructive">{errors.age}</p>}
            </div>
          )}
        </div>

        {/* Sub-group */}
        <Field label="Sub-group / Council" required error={errors.subGroupId}>
          <SubGroupSelect
            subGroups={subGroups}
            superGroups={superGroups}
            value={subGroupId}
            onChange={setSubGroupId}
            placeholder="Select a sub-group…"
          />
        </Field>

        {/* Room type */}
        <Field label="Room type preference" required error={errors.roomTypePreferenceId}>
          <select
            value={roomTypePreferenceId}
            onChange={(e) => setRoomTypePreferenceId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Select a room type…</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name} — {formatMoney(rt.price, currency)}
              </option>
            ))}
          </select>
          {selectedRoomType && (
            <p className="mt-1 text-sm text-muted-foreground">
              Fee owed: {formatMoney(selectedRoomType.price, currency)}
            </p>
          )}
        </Field>

        {/* Soft duplicate warnings */}
        {softDup && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="mb-2">{softDup.message}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => acknowledgeAndResubmit(softDup.type)}
                className="border-amber-300 text-amber-800 hover:bg-amber-100"
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
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add participant'}
        </Button>
      </form>

      {/* Phone duplicate confirmation modal */}
      {showPhoneDupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowPhoneDupModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border bg-background p-5 shadow-xl">
            <h2 className="mb-2 text-base font-semibold">Phone already registered</h2>
            <p className="mb-4 text-sm text-muted-foreground">{phoneDupMessage}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPhoneDupModal(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={acknowledgePhoneAndResubmit}>
                Register anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
