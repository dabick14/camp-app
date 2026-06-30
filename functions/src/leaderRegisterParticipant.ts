import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

interface LeaderRegisterParticipantData {
  fullName: string
  phone: string
  email?: string
  gender: string
  dateOfBirth?: string
  age?: number
  roomTypePreferenceId: string
  acknowledgedDuplicates?: string[]
}

// Callable, not HTTP — CORS is handled automatically by the callable
// protocol, and `request.auth` is verified server-side by the platform
// before the handler ever runs (no manual Bearer-token parsing needed,
// and no way to forge it the way a raw HTTP body can be tampered with).
export const leaderRegisterParticipant = onCall<LeaderRegisterParticipantData>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.')
  }
  const uid = request.auth.uid
  const displayName = request.auth.token.email ?? uid

  const db = getFirestore()

  // Caller must be an active leader — admins and deactivated/non-leaders are
  // rejected. Admins use adminAddParticipant instead.
  const leaderSnap = await db.doc(`leaders/${uid}`).get()
  if (!leaderSnap.exists || leaderSnap.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Not an active leader')
  }
  const leader = leaderSnap.data()!
  // The core of the pivot: campId/subGroupId/subGroupName come from the
  // leader's own doc — the ONLY source for these three values. They are
  // deliberately never read off `request.data` below, even though a client
  // could include them in the payload. Whatever a leader sends for these
  // fields is discarded, not merely overridden.
  const campId = leader.campId as string
  const subGroupId = leader.subGroupId as string
  const subGroupName = leader.subGroupName as string

  // Destructure only the fields a leader is allowed to control. Note the
  // absence of subGroupId/subGroupName/campId here — this is intentional,
  // not an oversight, and is the property the tamper test asserts on.
  const { fullName, phone, gender, roomTypePreferenceId, email, dateOfBirth, age } = request.data
  const acknowledged: string[] = request.data.acknowledgedDuplicates ?? []

  if (!fullName?.trim() || !phone?.trim() || !gender || !roomTypePreferenceId) {
    throw new HttpsError('invalid-argument', 'Missing required fields')
  }
  if (gender !== 'M' && gender !== 'F') {
    throw new HttpsError('invalid-argument', 'gender must be M or F')
  }

  const campSnap = await db.doc(`camps/${campId}`).get()
  if (!campSnap.exists) {
    throw new HttpsError('not-found', 'Camp not found')
  }
  const camp = campSnap.data()!
  if (!camp.registrationOpen) {
    throw new HttpsError('failed-precondition', 'Registration is closed for this camp')
  }

  const roomTypeSnap = await db.doc(`camps/${campId}/roomTypes/${roomTypePreferenceId}`).get()
  if (!roomTypeSnap.exists) {
    throw new HttpsError('not-found', 'Room type not found')
  }
  const roomTypeData = roomTypeSnap.data()!
  const roomTypePreferenceName = roomTypeData.name as string
  const feeOwed = roomTypeData.price as number

  // Age gate
  if (camp.minAge != null || camp.maxAge != null) {
    let computedAge: number | null = null
    if (dateOfBirth) {
      const dob = new Date(`${dateOfBirth}T12:00:00Z`)
      const campStart = (camp.startDate as FirebaseFirestore.Timestamp).toDate()
      computedAge = Math.floor(
        (campStart.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      )
    } else if (age != null) {
      computedAge = age
    }
    if (computedAge !== null) {
      if (camp.minAge != null && computedAge < (camp.minAge as number)) {
        throw new HttpsError(
          'failed-precondition',
          `This camp has a minimum age of ${camp.minAge}. Please contact the organizers if this is an error.`,
          { error: 'AGE_BELOW_MIN' },
        )
      }
      if (camp.maxAge != null && computedAge > (camp.maxAge as number)) {
        throw new HttpsError(
          'failed-precondition',
          `This camp has a maximum age of ${camp.maxAge}. Please contact the organizers if this is an error.`,
          { error: 'AGE_EXCEEDED' },
        )
      }
    }
  }

  // Reconciliation gate, scoped to the leader's own sub-group — blocks late
  // registrations while an OPEN batch still has an unallocated balance.
  // Same rule the public form had; here it can only ever apply to the
  // caller's own sub-group since subGroupId is server-derived above.
  const openBatchesSnap = await db
    .collection(`camps/${campId}/paymentBatches`)
    .where('subGroupId', '==', subGroupId)
    .where('status', '==', 'OPEN')
    .get()
  const hasUnreconciledBalance = openBatchesSnap.docs.some((d) => {
    const b = d.data()
    return (b.amountReceived as number) - (b.amountAllocated as number) > 0
  })
  if (hasUnreconciledBalance) {
    throw new HttpsError(
      'failed-precondition',
      `${subGroupName} cannot accept new registrations until your last payment batch is reconciled. Contact the camp administrator.`,
      { error: 'UNRECONCILED_BATCH' },
    )
  }

  const participantsRef = db.collection(`camps/${campId}/participants`)

  // Layer 1: Phone hard block
  const phoneSnap = await participantsRef
    .where('phone', '==', phone.trim())
    .limit(5)
    .get()
  const phoneExists = phoneSnap.docs.some(
    (d) => d.data().registrationState === 'REGISTERED',
  )
  if (phoneExists) {
    throw new HttpsError(
      'already-exists',
      'This phone number is already registered.',
      { error: 'DUPLICATE_PHONE' },
    )
  }

  // Layer 2: Name + DOB soft check
  if (!acknowledged.includes('DUPLICATE_NAME_DOB') && dateOfBirth) {
    const dobTs = Timestamp.fromDate(new Date(`${dateOfBirth}T12:00:00Z`))
    const dobSnap = await participantsRef
      .where('dateOfBirth', '==', dobTs)
      .limit(20)
      .get()
    const nameMatch = dobSnap.docs.some(
      (d) =>
        d.data().registrationState === 'REGISTERED' &&
        (d.data().fullName as string).toLowerCase().trim() ===
          fullName.trim().toLowerCase(),
    )
    if (nameMatch) {
      throw new HttpsError(
        'already-exists',
        'Someone with the same name and date of birth is already registered. If this is not a duplicate, click Register anyway.',
        { error: 'DUPLICATE_NAME_DOB' },
      )
    }
  }

  // Layer 3: Email soft check
  if (!acknowledged.includes('DUPLICATE_EMAIL') && email?.trim()) {
    const emailLower = email.trim().toLowerCase()
    const emailSnap = await participantsRef
      .where('emailLower', '==', emailLower)
      .limit(5)
      .get()
    const emailExists = emailSnap.docs.some(
      (d) => d.data().registrationState === 'REGISTERED',
    )
    if (emailExists) {
      throw new HttpsError(
        'already-exists',
        'This email address is already registered. If this is not a duplicate, click Register anyway.',
        { error: 'DUPLICATE_EMAIL' },
      )
    }
  }

  const participant: Record<string, unknown> = {
    fullName: fullName.trim(),
    phone: phone.trim(),
    gender,
    subGroupId,
    subGroupName,
    roomTypePreferenceId,
    roomTypePreferenceName,
    feeOwed,
    amountPaid: 0,
    registrationState: 'REGISTERED',
    checkInState: 'NOT_ARRIVED',
    tags: [],
    roomId: null,
    source: uid,
    updatedBy: displayName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (email?.trim()) {
    participant.email = email.trim()
    participant.emailLower = email.trim().toLowerCase()
  }
  if (dateOfBirth) {
    participant.dateOfBirth = Timestamp.fromDate(new Date(`${dateOfBirth}T12:00:00Z`))
  }
  if (age != null) participant.age = age

  const ref = await participantsRef.add(participant)

  return {
    participantId: ref.id,
    fullName: participant.fullName as string,
    subGroupName,
    roomTypePreferenceName,
    feeOwed,
    currency: (camp.currency as string) ?? 'GHS',
    campName: camp.name as string,
  }
})
