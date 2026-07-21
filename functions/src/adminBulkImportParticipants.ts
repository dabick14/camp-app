import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

// One request = one Firestore batch. Client chunks at 200 rows so this stays
// well under the 500-op batch limit; this cap is defense-in-depth against a
// hand-crafted oversized request.
const MAX_ROWS_PER_REQUEST = 500

export interface BulkImportRow {
  rowNum: number
  fullName: string
  phone?: string
  gender: string
  subGroupId: string
  roomTypePreferenceId: string
}

export interface BulkImportSkip {
  rowNum: number
  reason: string
}

export interface BulkImportResult {
  imported: number
  skipped: BulkImportSkip[]
}

/**
 * Writes one chunk of CSV-imported participants in a single Firestore batch.
 *
 * Mirrors adminAddParticipant's defaults (REGISTERED/NOT_ARRIVED/tags:[]/amountPaid:0)
 * but resolves subGroupName/roomTypePreferenceName/feeOwed server-side from a
 * single read of each collection rather than trusting client-supplied names —
 * same "never trust the client for fee-bearing fields" rule as adminAddParticipant.
 *
 * Rows referencing a subGroupId/roomTypePreferenceId that no longer exists
 * (deleted between client-side preview and import) are skipped, not written,
 * and reported back in `skipped` — this is the only server-side rejection;
 * everything else (name/gender/duplicate review) was already decided by the
 * admin in the client-side preview.
 */
export async function runBulkImportChunk(
  db: FirebaseFirestore.Firestore,
  campId: string,
  rows: BulkImportRow[],
  uid: string,
  displayName: string,
): Promise<BulkImportResult> {
  const subGroupsSnap = await db.collection(`camps/${campId}/subGroups`).get()
  const subGroupNames = new Map(subGroupsSnap.docs.map((d) => [d.id, d.data().name as string]))

  const roomTypesSnap = await db.collection(`camps/${campId}/roomTypes`).get()
  const roomTypes = new Map(
    roomTypesSnap.docs.map((d) => [d.id, { name: d.data().name as string, price: d.data().price as number }]),
  )

  const participantsRef = db.collection(`camps/${campId}/participants`)
  const batch = db.batch()
  const skipped: BulkImportSkip[] = []
  let queued = 0
  const now = FieldValue.serverTimestamp()

  for (const row of rows) {
    const subGroupName = subGroupNames.get(row.subGroupId)
    if (!subGroupName) {
      skipped.push({ rowNum: row.rowNum, reason: 'Sub-group no longer exists' })
      continue
    }
    const roomType = roomTypes.get(row.roomTypePreferenceId)
    if (!roomType) {
      skipped.push({ rowNum: row.rowNum, reason: 'Room type no longer exists' })
      continue
    }
    if (row.gender !== 'M' && row.gender !== 'F') {
      skipped.push({ rowNum: row.rowNum, reason: 'gender must be M or F' })
      continue
    }
    if (!row.fullName?.trim()) {
      skipped.push({ rowNum: row.rowNum, reason: 'fullName is required' })
      continue
    }

    const participant: Record<string, unknown> = {
      fullName: row.fullName.trim(),
      gender: row.gender,
      subGroupId: row.subGroupId,
      subGroupName,
      roomTypePreferenceId: row.roomTypePreferenceId,
      roomTypePreferenceName: roomType.name,
      feeOwed: roomType.price,
      amountPaid: 0,
      registrationState: 'REGISTERED',
      checkInState: 'NOT_ARRIVED',
      tags: [],
      roomId: null,
      source: uid,
      updatedBy: displayName,
      createdAt: now,
      updatedAt: now,
    }
    if (row.phone?.trim()) participant.phone = row.phone.trim()

    batch.set(participantsRef.doc(), participant)
    queued++
  }

  if (queued > 0) await batch.commit()

  return { imported: queued, skipped }
}

export const adminBulkImportParticipants = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

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

  const adminSnap = await db.doc(`admins/${uid}`).get()
  if (!adminSnap.exists) {
    res.status(403).json({ error: 'Not an admin' })
    return
  }

  const { campId, rows } = req.body as { campId?: string; rows?: BulkImportRow[] }
  if (!campId || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'campId and a non-empty rows array are required' })
    return
  }
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    res.status(400).json({ error: `Too many rows in a single request (max ${MAX_ROWS_PER_REQUEST})` })
    return
  }

  try {
    const campSnap = await db.doc(`camps/${campId}`).get()
    if (!campSnap.exists) {
      res.status(404).json({ error: 'Camp not found' })
      return
    }

    const result = await runBulkImportChunk(db, campId, rows, uid, displayName)
    res.json(result)
  } catch (err) {
    console.error('adminBulkImportParticipants error:', err)
    res.status(500).json({ error: 'Import failed. Please try again.' })
  }
})
