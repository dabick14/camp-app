import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

interface AdminAddParticipantData {
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

export const adminAddParticipant = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Verify auth token
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const idToken = authHeader.slice(7)

  let uid: string
  let displayName: string
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
    displayName = decoded.email ?? uid
  } catch {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  const db = getFirestore()

  // Verify admin
  const adminSnap = await db.doc(`admins/${uid}`).get()
  if (!adminSnap.exists) {
    res.status(403).json({ error: 'Not an admin' })
    return
  }

  const data: AdminAddParticipantData = req.body
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
    // Camp — no registrationOpen check for admin
    const campSnap = await db.doc(`camps/${campId}`).get()
    if (!campSnap.exists) {
      res.status(404).json({ error: 'Camp not found' })
      return
    }
    const camp = campSnap.data()!

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

    const participantsRef = db.collection(`camps/${campId}/participants`)

    // Layer 1: Phone — 409 for admin (acknowledgeable, not a hard block)
    if (!acknowledged.includes('DUPLICATE_PHONE')) {
      const phoneSnap = await participantsRef
        .where('phone', '==', phone.trim())
        .limit(5)
        .get()
      const phoneExists = phoneSnap.docs.some(
        (d) => d.data().registrationState === 'REGISTERED',
      )
      if (phoneExists) {
        res.status(409).json({
          error: 'DUPLICATE_PHONE',
          message: 'A participant with this phone number is already registered.',
        })
        return
      }
    }

    // Layer 2: Name + DOB soft check
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
            'A participant with the same name and date of birth is already registered.',
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
          message: 'A participant with this email address is already registered.',
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
      updatedBy: displayName,
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
    console.error('adminAddParticipant error:', err)
    res.status(500).json({ error: 'Failed to add participant. Please try again.' })
  }
})
