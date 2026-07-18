import { doc, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { deleteStoredImage, uploadImageToFolder } from '@/lib/imageUpload'
import type { BatchReceipt } from '../types'

function batchRef(campId: string, batchId: string) {
  return doc(db, 'camps', campId, 'paymentBatches', batchId)
}

/**
 * Uploads a receipt image for a batch and attaches it to the batch doc.
 * Two network steps (Storage upload, then Firestore update) — on failure,
 * the caller should retry the whole call. If the Storage upload succeeded
 * but the Firestore attach failed, the object is orphaned in Storage
 * (harmless — no doc reference, so it's simply invisible) and the retry's
 * re-upload just creates a second object under a new name.
 */
export async function uploadReceiptToBatch(
  campId: string,
  batchId: string,
  file: File,
  uid: string,
  onProgress?: (pct: number) => void,
): Promise<BatchReceipt> {
  const receipt = await uploadImageToFolder(
    `camps/${campId}/batches/${batchId}/receipts`,
    file,
    uid,
    onProgress,
  )

  await updateDoc(batchRef(campId, batchId), {
    receiptImageUrls: arrayUnion(receipt),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })

  return receipt
}

/** Deletes the Storage object and removes it from the batch doc's receipt array. */
export async function removeReceiptFromBatch(
  campId: string,
  batchId: string,
  receipt: BatchReceipt,
  uid: string,
): Promise<void> {
  await deleteStoredImage(receipt.storagePath)

  await updateDoc(batchRef(campId, batchId), {
    receiptImageUrls: arrayRemove(receipt),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}
