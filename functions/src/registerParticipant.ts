import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

interface RegisterParticipantData {
  campId: string
  fullName: string
  phone: string
  email?: string
  gender: string
  dateOfBirth?: string
  age?: number
  subGroupId: string
  roomTypePreferenceId: string
  acknowledgedDuplicates?: string[]
}

export const registerParticipant = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const data: RegisterParticipantData = req.body
  const { campId, fullName, phone, gender, subGroupId, roomTypePreferenceId } = data
  const acknowledged: string[] = data.acknowledgedDuplicates ?? []

  if (!campId || !fullName?.trim() || !phone?.trim() || !gender || !subGroupId || !roomTypePreferenceId) {
    res.status(400).json({ error: 'Missing required fields' })
    return
  }
  if (gender !== 'M' && gender !== 'F') {
    res.status(400).json({ error: 'gender must be M or F' })
    return
  }

  try {
    const db = getFirestore()
    const campSnap = await db.doc(`camps/${campId}`).get()
    if (!campSnap.exists) {
      res.status(404).json({ error: 'Camp not found' })
      return
    }
    const camp = campSnap.data()!
    if (!camp.registrationOpen) {
      res.status(400).json({ error: 'Registration is closed for this camp' })
      return
    }

    const subGroupSnap = await db.doc(`camps/${campId}/subGroups/${subGroupId}`).get()
    if (!subGroupSnap.exists) {
      res.status(404).json({ error: 'Sub-group not found' })
      return
    }
    const subGroupName = subGroupSnap.data()!.name as string

    const roomTypeSnap = await db.doc(`camps/${campId}/roomTypes/${roomTypePreferenceId}`).get()
    if (!roomTypeSnap.exists) {
      res.status(404).json({ error: 'Room type not found' })
      return
    }
    const roomTypeData = roomTypeSnap.data()!
    const roomTypePreferenceName = roomTypeData.name as string
    const feeOwed = roomTypeData.price as number

    // Age gate
    if (camp.minAge != null || camp.maxAge != null) {
      let computedAge: number | null = null
      if (data.dateOfBirth) {
        const dob = new Date(`${data.dateOfBirth}T12:00:00Z`)
        const campStart = (camp.startDate as FirebaseFirestore.Timestamp).toDate()
        computedAge = Math.floor(
          (campStart.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
        )
      } else if (data.age != null) {
        computedAge = data.age
      }
      if (computedAge !== null) {
        if (camp.minAge != null && computedAge < (camp.minAge as number)) {
          res.status(400).json({
            error: 'AGE_BELOW_MIN',
            message: `This camp has a minimum age of ${camp.minAge}. Please contact the organizers if this is an error.`,
          })
          return
        }
        if (camp.maxAge != null && computedAge > (camp.maxAge as number)) {
          res.status(400).json({
            error: 'AGE_EXCEEDED',
            message: `This camp has a maximum age of ${camp.maxAge}. Please contact the organizers if this is an error.`,
          })
          return
        }
      }
    }

    const participantsRef = db.collection(`camps/${campId}/participants`)

    // Layer 1: Phone hard block — non-acknowledgeable for public form
    const phoneSnap = await participantsRef
      .where('phone', '==', phone.trim())
      .limit(5)
      .get()
    const phoneExists = phoneSnap.docs.some(
      (d) => d.data().registrationState === 'REGISTERED',
    )
    if (phoneExists) {
      res.status(400).json({
        error: 'DUPLICATE_PHONE',
        message:
          'This phone number is already registered. If you registered before, contact your council leader.',
      })
      return
    }

    // Layer 2: Name + DOB soft check (only if DOB provided)
    if (!acknowledged.includes('DUPLICATE_NAME_DOB') && data.dateOfBirth) {
      const dobTs = Timestamp.fromDate(new Date(`${data.dateOfBirth}T12:00:00Z`))
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
        res.status(409).json({
          error: 'DUPLICATE_NAME_DOB',
          message:
            'Someone with the same name and date of birth is already registered. If this is not you, click Register anyway.',
        })
        return
      }
    }

    // Layer 3: Email soft check
    if (!acknowledged.includes('DUPLICATE_EMAIL') && data.email?.trim()) {
      const emailLower = data.email.trim().toLowerCase()
      const emailSnap = await participantsRef
        .where('emailLower', '==', emailLower)
        .limit(5)
        .get()
      const emailExists = emailSnap.docs.some(
        (d) => d.data().registrationState === 'REGISTERED',
      )
      if (emailExists) {
        res.status(409).json({
          error: 'DUPLICATE_EMAIL',
          message:
            'This email address is already registered. If this is not you, click Register anyway.',
        })
        return
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
      updatedBy: 'self',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (data.email?.trim()) {
      participant.email = data.email.trim()
      participant.emailLower = data.email.trim().toLowerCase()
    }
    if (data.dateOfBirth) {
      participant.dateOfBirth = Timestamp.fromDate(
        new Date(`${data.dateOfBirth}T12:00:00Z`),
      )
    }
    if (data.age != null) participant.age = data.age

    const ref = await participantsRef.add(participant)

    res.json({
      participantId: ref.id,
      fullName: participant.fullName,
      subGroupName,
      roomTypePreferenceName,
      feeOwed,
      currency: (camp.currency as string) ?? 'GHS',
      campName: camp.name as string,
    })
  } catch (err) {
    console.error('registerParticipant error:', err)
    res.status(500).json({ error: 'Registration failed. Please try again.' })
  }
})
