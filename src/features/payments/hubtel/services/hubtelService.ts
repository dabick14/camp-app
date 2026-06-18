import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/lib/firebase'
import type {
  HubtelTransaction,
  InitiateCheckoutResult,
  QuarantineItem,
  VerifyResult,
} from '../types'

const FN_BASE = 'https://us-central1-camp-app-119bb.cloudfunctions.net'

async function authedPost<T>(
  fn: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T & { error?: string; message?: string } }> {
  const idToken = await getAuth().currentUser?.getIdToken()
  if (!idToken) throw new Error('Not authenticated. Please sign in again.')
  const res = await fetch(`${FN_BASE}/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export interface InitiateCheckoutInput {
  campId: string
  subGroupId: string
  amountGHS: number
  description?: string
  payeeName?: string
  payeeEmail?: string
  payeePhone?: string
  returnOrigin?: string
}

export async function initiateCheckout(
  input: InitiateCheckoutInput,
): Promise<InitiateCheckoutResult> {
  const { ok, data } = await authedPost<InitiateCheckoutResult>(
    'initiateHubtelCheckout',
    input,
  )
  if (!ok) throw new Error(data.error || data.message || 'Failed to start checkout')
  return data
}

export async function verifyPayment(
  campId: string,
  reference: string,
): Promise<VerifyResult> {
  const { data } = await authedPost<VerifyResult>('verifyHubtelPayment', {
    campId,
    reference,
  })
  return data
}

export async function listHubtelTransactions(
  campId: string,
): Promise<HubtelTransaction[]> {
  const q = query(
    collection(db, 'camps', campId, 'hubtelTransactions'),
    orderBy('createdAt', 'desc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as HubtelTransaction)
}

export async function listQuarantine(): Promise<QuarantineItem[]> {
  const q = query(collection(db, 'hubtelQuarantine'), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as QuarantineItem)
}

export interface AssignQuarantineInput {
  quarantineId: string
  campId: string
  subGroupId: string
  subGroupName: string
  amount: number
  reference: string
  checkoutId?: string | null
  channel?: string | null
  uid: string
}

/**
 * Manually link an orphan callback to a camp/sub-group by creating a PaymentBatch and
 * marking the quarantine doc MATCHED — in one transaction. Once linked it is not
 * unlinkable (audit-only); a correction is a separate "refund" mark.
 */
export async function assignQuarantineToBatch(
  params: AssignQuarantineInput,
): Promise<string> {
  const qRef = doc(db, 'hubtelQuarantine', params.quarantineId)
  const batchRef = doc(collection(db, 'camps', params.campId, 'paymentBatches'))

  await runTransaction(db, async (tx) => {
    const qSnap = await tx.get(qRef)
    if (!qSnap.exists()) throw new Error('Quarantine item no longer exists')
    if (qSnap.data().status === 'MATCHED') throw new Error('Already assigned to a batch')

    const batch: Record<string, unknown> = {
      referenceCode: params.reference,
      hubtelReference: params.reference,
      subGroupId: params.subGroupId,
      subGroupName: params.subGroupName,
      amountReceived: params.amount,
      amountAllocated: 0,
      method: 'MOMO',
      source: 'hubtel',
      status: 'OPEN',
      varianceAcknowledged: false,
      receivedAt: serverTimestamp(),
      receivedBy: params.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
    if (params.checkoutId) {
      batch.hubtelCheckoutId = params.checkoutId
      batch.externalReference = params.checkoutId
    }
    if (params.channel) batch.channel = params.channel
    tx.set(batchRef, batch)

    tx.update(qRef, {
      status: 'MATCHED',
      batchId: batchRef.id,
      campId: params.campId,
      matchedBy: params.uid,
      matchedAt: serverTimestamp(),
    })
  })

  return batchRef.id
}

export async function markQuarantineRefunded(
  quarantineId: string,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, 'hubtelQuarantine', quarantineId), {
    status: 'REFUNDED',
    refundedBy: uid,
    refundedAt: serverTimestamp(),
  })
}
