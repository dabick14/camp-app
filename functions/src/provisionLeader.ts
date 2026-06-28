import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

// Public Firebase Web API key (same one as VITE_FIREBASE_API_KEY in the client
// bundle — not a secret). Needed to trigger Identity Toolkit's hosted
// password-reset email; the Admin SDK can generate a reset link but has no
// equivalent for actually sending it.
const WEB_API_KEY = 'AIzaSyDAW94CNt2Hxdgh0Ee69bzGUY05a3DGgBY'

interface ProvisionLeaderData {
  campId: string
  email: string
  displayName?: string
  subGroupId: string
}

export const provisionLeader = onRequest({ cors: true }, async (req, res) => {
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

  let callerUid: string
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    callerUid = decoded.uid
  } catch {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  const db = getFirestore()

  const callerAdminSnap = await db.doc(`admins/${callerUid}`).get()
  if (!callerAdminSnap.exists) {
    res.status(403).json({ error: 'Not an admin' })
    return
  }

  const data: ProvisionLeaderData = req.body
  const { campId, subGroupId } = data
  const email = data.email?.trim().toLowerCase()
  const displayName = data.displayName?.trim()

  if (!campId || !email || !subGroupId) {
    res.status(400).json({ error: 'Missing required fields' })
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Enter a valid email address' })
    return
  }

  try {
    const subGroupSnap = await db.doc(`camps/${campId}/subGroups/${subGroupId}`).get()
    if (!subGroupSnap.exists) {
      res.status(404).json({ error: 'Sub-group not found' })
      return
    }
    const subGroupName = subGroupSnap.data()!.name as string

    // Server-side re-check — the client's exclusion list in the sub-group
    // picker is UX only. This is the actual enforcement point.
    const activeLeaderSnap = await db
      .collection('leaders')
      .where('campId', '==', campId)
      .where('subGroupId', '==', subGroupId)
      .where('active', '==', true)
      .limit(1)
      .get()
    if (!activeLeaderSnap.empty) {
      res.status(409).json({
        error: 'SUBGROUP_HAS_ACTIVE_LEADER',
        message: `${subGroupName} already has an active leader. Deactivate them first.`,
      })
      return
    }

    // Find or create the Firebase Auth account for this email.
    let uid: string
    try {
      const existing = await getAuth().getUserByEmail(email)
      uid = existing.uid
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
      const created = await getAuth().createUser({
        email,
        displayName: displayName || undefined,
        emailVerified: false,
      })
      uid = created.uid
    }

    // Guard against the admin/leader collision useUserRole() warns about —
    // refuse to double-provision an existing admin as a leader too.
    const existingAdminSnap = await db.doc(`admins/${uid}`).get()
    if (existingAdminSnap.exists) {
      res.status(409).json({
        error: 'EMAIL_IS_ADMIN',
        message: 'This email belongs to an existing admin account and cannot also be a leader.',
      })
      return
    }

    const leaderRef = db.doc(`leaders/${uid}`)
    const leaderSnap = await leaderRef.get()
    const leaderData: Record<string, unknown> = {
      email,
      campId,
      subGroupId,
      subGroupName,
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: callerUid,
    }
    if (displayName) leaderData.displayName = displayName

    if (leaderSnap.exists) {
      // Re-provisioning a previously deactivated leader record.
      await leaderRef.update(leaderData)
    } else {
      leaderData.createdAt = FieldValue.serverTimestamp()
      leaderData.createdBy = callerUid
      await leaderRef.set(leaderData)
    }

    // Trigger Firebase's hosted "set your password" email — same flow as
    // /login/reset, just admin-initiated instead of self-service.
    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      },
    )

    res.json({ uid, email, subGroupName })
  } catch (err) {
    console.error('provisionLeader error:', err)
    res.status(500).json({ error: 'Failed to provision leader. Please try again.' })
  }
})
