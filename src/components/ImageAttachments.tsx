import { useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { StoredImage } from '@/lib/imageUpload'

interface PendingUpload {
  id: string
  file: File
  progress: number
  status: 'uploading' | 'error'
  error?: string
}

interface ImageAttachmentsProps {
  images: StoredImage[]
  /** Uploads (compress + Storage + doc attach) — throws on failure so the item can be retried. */
  onUpload: (file: File, onProgress: (pct: number) => void) => Promise<unknown>
  /** Deletes the Storage object and detaches it from the doc. */
  onRemove: (image: StoredImage) => Promise<unknown>
  /** Called after a successful upload or removal so the caller can refetch its doc. */
  onChange: () => void
  addLabel?: string
  emptyMessage: string
  altText: string
  removeConfirmMessage?: string
}

/**
 * Shared thumbnail-grid + upload/lightbox/remove UI for image attachments.
 * Used by both batch receipts and ticket photos — one upload implementation,
 * not two diverging ones. Callers own the Firestore attach/detach (via
 * onUpload/onRemove); this component only manages local pending-upload state,
 * the lightbox, and the remove-in-flight indicator.
 */
export function ImageAttachments({
  images,
  onUpload,
  onRemove,
  onChange,
  addLabel = 'Add photo',
  emptyMessage,
  altText,
  removeConfirmMessage = 'Remove this photo? This cannot be undone.',
}: ImageAttachmentsProps) {
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [lightbox, setLightbox] = useState<StoredImage | null>(null)
  const [removingPath, setRemovingPath] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function startUpload(id: string, file: File) {
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'uploading', error: undefined, progress: 0 } : p)),
    )
    try {
      await onUpload(file, (pct) =>
        setPending((prev) => prev.map((p) => (p.id === id ? { ...p, progress: pct } : p))),
      )
      setPending((prev) => prev.filter((p) => p.id !== id))
      onChange()
    } catch (err) {
      setPending((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: 'error', error: (err as Error).message ?? 'Upload failed' } : p,
        ),
      )
    }
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    for (const file of Array.from(fileList)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setPending((prev) => [...prev, { id, file, progress: 0, status: 'uploading' }])
      startUpload(id, file)
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleRemove(image: StoredImage) {
    if (!window.confirm(removeConfirmMessage)) return
    setRemovingPath(image.storagePath)
    try {
      await onRemove(image)
      onChange()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to remove photo')
    } finally {
      setRemovingPath(null)
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Photos{images.length > 0 ? ` (${images.length})` : ''}
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="h-11 w-full whitespace-normal sm:h-7 sm:w-auto sm:whitespace-nowrap"
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="mr-1.5 h-3.5 w-3.5 shrink-0" />
          {addLabel}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
      </div>

      {images.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {images.map((img) => (
            <div
              key={img.storagePath}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              <button
                type="button"
                className="h-full w-full"
                onClick={() => setLightbox(img)}
                aria-label={`View ${altText.toLowerCase()} full size`}
              >
                <img src={img.url} alt={altText} className="h-full w-full object-cover" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${altText.toLowerCase()}`}
                onClick={() => handleRemove(img)}
                disabled={removingPath === img.storagePath}
                className="absolute top-1 right-1 rounded-full bg-black/60 p-1.5 text-white opacity-100 transition-opacity disabled:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                {removingPath === img.storagePath ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))}

          {pending
            .filter((p) => p.status === 'uploading')
            .map((p) => (
              <div
                key={p.id}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md border bg-muted p-2 text-center"
              >
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <div className="h-1 w-full max-w-16 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${p.progress}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">{p.progress}%</p>
              </div>
            ))}
        </div>
      )}

      {/* Failed uploads — full-width rows, not square tiles, so the error
          reason (can be a long Firebase message) has room without
          overflowing into neighboring thumbnails. */}
      {pending
        .filter((p) => p.status === 'error')
        .map((p) => (
          <div
            key={p.id}
            className="mt-3 flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-xs text-destructive">{p.error ?? 'Upload failed'}</p>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 sm:flex-none"
                onClick={() => startUpload(p.id, p.file)}
              >
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 flex-1 sm:flex-none"
                onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}

      {lightbox && (
        <Dialog open onOpenChange={(v) => !v && setLightbox(null)}>
          <DialogContent className="sm:max-w-2xl p-2">
            <DialogTitle className="sr-only">{altText}</DialogTitle>
            <img
              src={lightbox.url}
              alt={`${altText} full view`}
              className="max-h-[80vh] w-full rounded object-contain"
            />
            <p className="px-2 pb-1 text-xs text-muted-foreground">
              Uploaded {lightbox.uploadedAt.toDate().toLocaleString('en-GB')}
              {lightbox.uploadedBy ? ` by ${lightbox.uploadedBy}` : ''}
            </p>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
