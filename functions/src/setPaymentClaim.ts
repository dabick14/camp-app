import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

interface SetPaymentClaimData {
  participantId: string
  claimed: boolean
}

/**
 * Sets or clears a leader's payment claim on a participant.
 *
 * Claim is a pre-confirmation signal: it does NOT change amountPaid,
 * paymentState, or rooming eligibility. Admin confirmation (5b-ii) is the
 * step that reads claims and updates amountPaid.
 *
 * Security: campId and subGroupId are always derived from the caller's own
 * /leaders/{uid} doc — same server-trust pattern as leaderRegisterParticipant.
 * A crafted request with a foreign participantId is rejected if that participant
 * belongs to a different sub-group.
 */
export const setPaymentClaim = onCall<SetPaymentClaimData>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.')
  }
  const uid = request.auth.uid
  const displayName = request.auth.token.email ?? uid
  const db = getFirestore()

  const leaderSnap = await db.doc(`leaders/${uid}`).get()
  if (!leaderSnap.exists || leaderSnap.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Not an active leader')
  }
  const leader = leaderSnap.data()!
  const campId = leader.campId as string
  const subGroupId = leader.subGroupId as string

  const { participantId, claimed } = request.data
  if (!participantId) {
    throw new HttpsError('invalid-argument', 'participantId is required')
  }
  if (typeof claimed !== 'boolean') {
    throw new HttpsError('invalid-argument', 'claimed must be a boolean')
  }

  const participantRef = db.doc(`camps/${campId}/participants/${participantId}`)
  const participantSnap = await participantRef.get()
  if (!participantSnap.exists) {
    throw new HttpsError('not-found', 'Participant not found')
  }
  const participant = participantSnap.data()!

  // Sub-group boundary: reject cross-group claims even if the participant
  // exists in this camp.
  if (participant.subGroupId !== subGroupId) {
    throw new HttpsError(
      'permission-denied',
      'Participant does not belong to your sub-group',
    )
  }

  const now = FieldValue.serverTimestamp()

  if (claimed) {
    await participantRef.update({
      paymentClaimed: true,
      claimedBy: uid,
      claimedAt: now,
      updatedAt: now,
      updatedBy: displayName,
    })
  } else {
    await participantRef.update({
      paymentClaimed: false,
      claimedBy: FieldValue.delete(),
      claimedAt: FieldValue.delete(),
      updatedAt: now,
      updatedBy: displayName,
    })
  }

  return { participantId, claimed }
})
