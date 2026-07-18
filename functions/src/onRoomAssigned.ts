import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore } from 'firebase-admin/firestore'
import { sendSms } from './sms/smsService'
import {
  DEFAULT_ASSIGNED_TEMPLATE,
  DEFAULT_CHANGED_TEMPLATE,
  DEFAULT_SENDER_ID,
  firstNameOf,
  renderTemplate,
} from './sms/templates'

export const bmsApiKey = defineSecret('BMS_API_KEY')

interface SmsSettings {
  enabled?: boolean
  senderId?: string
  assignedTemplate?: string
  changedTemplate?: string
}

// Sends the room-assignment/room-change text. Fires only when roomId
// actually changes on a participant doc — comparing before/after here (not
// relying on which client wrote the doc) is what makes this exactly-once
// regardless of re-renders, retries, or unrelated field edits that also
// happen to touch the participant doc.
export const onRoomAssigned = onDocumentUpdated(
  { document: 'camps/{campId}/participants/{participantId}', secrets: [bmsApiKey] },
  async (event) => {
    if (!event.data) return

    const before = event.data.before.data()
    const after = event.data.after.data()

    const beforeRoomId: string | null = before.roomId ?? null
    const afterRoomId: string | null = after.roomId ?? null

    // Only a genuine assignment or reassignment fires a text: a brand-new
    // roomId (was empty) or a changed one (was set, now different). Room
    // clears (unassign) and no-op resaves of the same roomId are ignored.
    if (!afterRoomId || afterRoomId === beforeRoomId) return

    const trigger = beforeRoomId ? 'ROOM_CHANGED' : 'ROOM_ASSIGNED'
    const { campId, participantId } = event.params

    const db = getFirestore()
    const campSnap = await db.doc(`camps/${campId}`).get()
    const camp = campSnap.data() ?? {}
    const smsSettings: SmsSettings = camp.smsSettings ?? {}

    const template = trigger === 'ROOM_ASSIGNED'
      ? (smsSettings.assignedTemplate?.trim() || DEFAULT_ASSIGNED_TEMPLATE)
      : (smsSettings.changedTemplate?.trim() || DEFAULT_CHANGED_TEMPLATE)

    const message = renderTemplate(template, {
      FirstName: firstNameOf(after.fullName ?? ''),
      RoomNumber: after.roomNumber ?? '',
      RoomType: after.roomTypePreferenceName ?? '',
      CampName: camp.name ?? '',
    })

    await sendSms({
      db,
      campId,
      participantId,
      phone: after.phone ?? '',
      trigger,
      message,
      triggeredBy: 'system',
      apiKey: bmsApiKey.value(),
      senderId: smsSettings.senderId?.trim() || DEFAULT_SENDER_ID,
      enabled: smsSettings.enabled === true,
      // event.id uniquely identifies this exact trigger delivery — used as
      // the send log's doc id so a retried/redelivered event is a no-op.
      logId: event.id,
    })
  },
)
