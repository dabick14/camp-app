import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  type StorageError,
} from 'firebase/storage'
import { Timestamp } from 'firebase/firestore'
import { storage } from '@/lib/firebase'

/**
 * A single uploaded image attachment — shared shape for batch receipts and
 * ticket photos. Firestore stores only the URL + metadata; the actual file
 * lives in Storage at `storagePath`.
 */
export interface StoredImage {
  url: string // download URL
  storagePath: string // Storage object path — needed to delete the object on removal
  uploadedBy: string
  uploadedAt: Timestamp
}

// Photos are for reference, not print — downscale + re-encode so storage
// stays small and uploads stay fast on flaky venue wifi.
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
 * Compresses and uploads an image under `folderPath` (e.g.
 * `camps/{campId}/batches/{batchId}/receipts` or
 * `camps/{campId}/tickets/{ticketId}/images`), returning its stored record.
 *
 * Does NOT touch Firestore — the caller attaches the result to its own
 * document (different callers use different field names/doc shapes), so
 * this stays the one shared primitive for "get a file into Storage."
 */
export async function uploadImageToFolder(
  folderPath: string,
  file: File,
  uid: string,
  onProgress?: (pct: number) => void,
): Promise<StoredImage> {
  const blob = await compressImage(file)
  const contentType = blob.type || file.type || 'image/jpeg'
  const ext = contentType === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg')
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`
  const storagePath = `${folderPath}/${fileName}`
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
  return {
    url,
    storagePath,
    uploadedBy: uid,
    uploadedAt: Timestamp.now(), // serverTimestamp() sentinels aren't allowed inside arrayUnion elements
  }
}

/** Deletes a Storage object; tolerant of it already being gone. */
export async function deleteStoredImage(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath))
  } catch (err) {
    if ((err as StorageError).code !== 'storage/object-not-found') throw err
  }
}
