import { onCall, HttpsError } from 'firebase-functions/v2/https'
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

export const registerParticipant = onCall(async (request) => {
  const data = request.data as RegisterParticipantData

  // Validate required fields
  const { campId, fullName, phone, gender, subGroupId, roomTypePreferenceId } = data
  if (!campId || !fullName?.trim() || !phone?.trim() || !gender || !subGroupId || !roomTypePreferenceId) {
    throw new HttpsError('invalid-argument', 'Missing required fields')
  }
  if (gender !== 'M' && gender !== 'F') {
    throw new HttpsError('invalid-argument', 'gender must be M or F')
  }

  // Load camp — verify exists and registration is open
  const campSnap = await db.doc(`camps/${campId}`).get()
  if (!campSnap.exists) {
    throw new HttpsError('not-found', 'Camp not found')
  }
  const camp = campSnap.data()!
  if (!camp.registrationOpen) {
    throw new HttpsError('failed-precondition', 'Registration is closed for this camp')
  }

  // Load sub-group
  const subGroupSnap = await db.doc(`camps/${campId}/subGroups/${subGroupId}`).get()
  if (!subGroupSnap.exists) {
    throw new HttpsError('not-found', 'Sub-group not found')
  }
  const subGroupName = subGroupSnap.data()!.name as string

  // Load room type — price at this moment becomes feeOwed
  const roomTypeSnap = await db.doc(`camps/${campId}/roomTypes/${roomTypePreferenceId}`).get()
  if (!roomTypeSnap.exists) {
    throw new HttpsError('not-found', 'Room type not found')
  }
  const roomTypeData = roomTypeSnap.data()!
  const roomTypePreferenceName = roomTypeData.name as string
  const feeOwed = roomTypeData.price as number

  // Build participant doc — omit undefined-valued optional fields
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
    // Store as UTC noon to avoid timezone boundary issues
    participant.dateOfBirth = Timestamp.fromDate(new Date(`${data.dateOfBirth}T12:00:00Z`))
  }
  if (data.age != null) participant.age = data.age
  if (data.emergencyContactName?.trim()) participant.emergencyContactName = data.emergencyContactName.trim()
  if (data.emergencyContactPhone?.trim()) participant.emergencyContactPhone = data.emergencyContactPhone.trim()

  const ref = await db.collection(`camps/${campId}/participants`).add(participant)

  return {
    participantId: ref.id,
    fullName: participant.fullName,
    subGroupName,
    roomTypePreferenceName,
    feeOwed,
    currency: (camp.currency as string) ?? 'GHS',
    campName: camp.name as string,
  }
})
