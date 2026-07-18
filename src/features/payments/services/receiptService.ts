import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  type StorageError,
} from 'firebase/storage'
import { doc, updateDoc, arrayUnion, arrayRemove, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db, storage } from '@/lib/firebase'
import type { BatchReceipt } from '../types'

function batchRef(campId: string, batchId: string) {
  return doc(db, 'camps', campId, 'paymentBatches', batchId)
}

// Screenshots are for reference, not print — downscale + re-encode so
// storage stays small and uploads stay fast on flaky venue data.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82
const SKIP_COMPRESSION_BELOW_BYTES = 1_500_000

async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1 && file.size < SKIP_COMPRESSION_BELOW_BYTES) {
      bitmap.close()
      return file
    }
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    return blob ?? file
  } catch {
    // Decoding failed (unsupported format, corrupt file, etc.) — fall back
    // to uploading the original rather than blocking the upload entirely.
    return file
  }
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
  const blob = await compressImage(file)
  const contentType = blob.type || file.type || 'image/jpeg'
  const ext = contentType === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg')
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`
  const storagePath = `camps/${campId}/batches/${batchId}/receipts/${fileName}`
  const storageRef = ref(storage, storagePath)

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, { contentType })
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err),
      () => resolve(),
    )
  })

  const url = await getDownloadURL(storageRef)
  const receipt: BatchReceipt = {
    url,
    storagePath,
    uploadedBy: uid,
    uploadedAt: Timestamp.now(), // serverTimestamp() sentinels aren't allowed inside arrayUnion elements
  }

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
  try {
    await deleteObject(ref(storage, receipt.storagePath))
  } catch (err) {
    if ((err as StorageError).code !== 'storage/object-not-found') throw err
  }

  await updateDoc(batchRef(campId, batchId), {
    receiptImageUrls: arrayRemove(receipt),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}
