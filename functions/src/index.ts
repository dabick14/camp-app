import { onRequest } from 'firebase-functions/v2/https'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

initializeApp()
const db = getFirestore()

interface RegisterParticipantData {
  campId: string
  fullName: string
  phone: string
  email?: string
  gender: string
  dateOfBirth?: string   // YYYY-MM-DD
  age?: number
  emergencyContactName?: string
  emergencyContactPhone?: string
  subGroupId: string
  roomTypePreferenceId: string
}

// HTTP function — cors: true handles the OPTIONS preflight via cors middleware
// before any function code runs, which is more reliable than onCall's built-in handling.
export const registerParticipant = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const data: RegisterParticipantData = req.body

  const { campId, fullName, phone, gender, subGroupId, roomTypePreferenceId } = data

  if (!campId || !fullName?.trim() || !phone?.trim() || !gender || !subGroupId || !roomTypePreferenceId) {
    res.status(400).json({ error: 'Missing required fields' })
    return
  }
  if (gender !== 'M' && gender !== 'F') {
    res.status(400).json({ error: 'gender must be M or F' })
    return
  }

  try {
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

    if (data.email?.trim()) participant.email = data.email.trim()
    if (data.dateOfBirth) {
      participant.dateOfBirth = Timestamp.fromDate(new Date(`${data.dateOfBirth}T12:00:00Z`))
    }
    if (data.age != null) participant.age = data.age
    if (data.emergencyContactName?.trim()) participant.emergencyContactName = data.emergencyContactName.trim()
    if (data.emergencyContactPhone?.trim()) participant.emergencyContactPhone = data.emergencyContactPhone.trim()

    const ref = await db.collection(`camps/${campId}/participants`).add(participant)

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
