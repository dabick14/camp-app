import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { initiateCheckout, HUBTEL_SECRETS } from './hubtelClient'
import { generateReference } from './reference'
import { HUBTEL_CALLBACK_URL, APP_BASE } from './constants'

interface InitiateBody {
  campId?: string
  subGroupId?: string
  amountGHS?: number
  description?: string
  payeeName?: string
  payeeEmail?: string
  payeePhone?: string
  returnOrigin?: string
}

/**
 * Admin-only. Creates a pending hubtelTransactions session + a top-level reference
 * pointer, then initiates a Hubtel checkout and returns the payable URLs so the admin
 * can complete payment in-app (onsite/iframe). Confirmation happens later via the
 * callback or the verify poll — never here.
 */
export const initiateHubtelCheckout = onRequest(
  { cors: true, secrets: HUBTEL_SECRETS },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    let uid: string
    try {
      uid = (await getAuth().verifyIdToken(authHeader.slice(7))).uid
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

    const body: InitiateBody = req.body || {}
    const { campId, subGroupId, amountGHS } = body
    if (
      !campId ||
      !subGroupId ||
      typeof amountGHS !== 'number' ||
      !Number.isFinite(amountGHS) ||
      amountGHS <= 0
    ) {
      res.status(400).json({ error: 'Missing or invalid fields' })
      return
    }

    try {
      const campSnap = await db.doc(`camps/${campId}`).get()
      if (!campSnap.exists) {
        res.status(404).json({ error: 'Camp not found' })
        return
      }
      const subGroupSnap = await db
        .doc(`camps/${campId}/subGroups/${subGroupId}`)
        .get()
      if (!subGroupSnap.exists) {
        res.status(404).json({ error: 'Sub-group not found' })
        return
      }
      const subGroupName = subGroupSnap.data()!.name as string
      const description = body.description?.trim() || `Camp payment - ${subGroupName}`

      const reference = generateReference()
      const sessionRef = db.doc(`camps/${campId}/hubtelTransactions/${reference}`)
      await sessionRef.set({
        reference,
        status: 'PENDING',
        amountExpected: amountGHS,
        amount: 0,
        subGroupId,
        subGroupName,
        description,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      // Top-level pointer so the public callback can resolve campId from the reference
      // alone, without a collection-group query.
      await db.doc(`hubtelReferences/${reference}`).set({
        campId,
        createdAt: FieldValue.serverTimestamp(),
      })

      const origin =
        typeof body.returnOrigin === 'string' && body.returnOrigin
          ? body.returnOrigin.replace(/\/$/, '')
          : APP_BASE
      const returnUrl = `${origin}/pay/return?reference=${reference}&campId=${campId}`

      let result
      try {
        result = await initiateCheckout({
          amountGHS,
          description,
          reference,
          callbackUrl: HUBTEL_CALLBACK_URL,
          returnUrl,
          payeeName: body.payeeName,
          payeeEmail: body.payeeEmail,
          payeeMobileNumber: body.payeePhone,
        })
      } catch (err) {
        await sessionRef
          .update({
            status: 'FAILED',
            error: (err as Error).message,
            updatedAt: FieldValue.serverTimestamp(),
          })
          .catch(() => {})
        console.error('initiateHubtelCheckout init error:', err)
        res.status(502).json({ error: 'Failed to initialize Hubtel checkout' })
        return
      }

      await sessionRef.update({
        checkoutId: result.checkoutId,
        checkoutUrl: result.checkoutUrl,
        updatedAt: FieldValue.serverTimestamp(),
      })

      res.json({
        reference,
        checkoutId: result.checkoutId,
        checkoutUrl: result.checkoutUrl,
        checkoutDirectUrl: result.checkoutDirectUrl,
      })
    } catch (err) {
      console.error('initiateHubtelCheckout error:', err)
      res.status(500).json({ error: 'Failed to initialize checkout' })
    }
  },
)
