import { useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { uploadReceiptToBatch, removeReceiptFromBatch } from '../services/receiptService'
import type { BatchReceipt } from '../types'

interface PendingUpload {
  id: string
  file: File
  progress: number
  status: 'uploading' | 'error'
  error?: string
}

interface BatchReceiptsProps {
  campId: string
  batchId: string
  receipts: BatchReceipt[]
  uid: string
  onChange: () => void
}

export function BatchReceipts({ campId, batchId, receipts, uid, onChange }: BatchReceiptsProps) {
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [lightbox, setLightbox] = useState<BatchReceipt | null>(null)
  const [removingPath, setRemovingPath] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function startUpload(id: string, file: File) {
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'uploading', error: undefined, progress: 0 } : p)),
    )
    try {
      await uploadReceiptToBatch(campId, batchId, file, uid, (pct) =>
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

  async function handleRemove(receipt: BatchReceipt) {
    if (!window.confirm('Remove this receipt? This cannot be undone.')) return
    setRemovingPath(receipt.storagePath)
    try {
      await removeReceiptFromBatch(campId, batchId, receipt, uid)
      onChange()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to remove receipt')
    } finally {
      setRemovingPath(null)
    }
  }

  return (
    <>
      <Separator />
      <section className="mt-8">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Receipts{receipts.length > 0 ? ` (${receipts.length})` : ''}
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="h-11 w-full whitespace-normal sm:h-7 sm:w-auto sm:whitespace-nowrap"
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            Add screenshot
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

        {receipts.length === 0 && pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No receipts attached yet. Attach a screenshot of the MoMo/cash handover for later reference.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {receipts.map((r) => (
              <div
                key={r.storagePath}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
              >
                <button
                  type="button"
                  className="h-full w-full"
                  onClick={() => setLightbox(r)}
                  aria-label="View receipt full size"
                >
                  <img src={r.url} alt="Batch receipt" className="h-full w-full object-cover" />
                </button>
                <button
                  type="button"
                  aria-label="Remove receipt"
                  onClick={() => handleRemove(r)}
                  disabled={removingPath === r.storagePath}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1.5 text-white opacity-100 transition-opacity disabled:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  {removingPath === r.storagePath ? (
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
      </section>

      {lightbox && (
        <Dialog open onOpenChange={(v) => !v && setLightbox(null)}>
          <DialogContent className="sm:max-w-2xl p-2">
            <DialogTitle className="sr-only">Receipt image</DialogTitle>
            <img
              src={lightbox.url}
              alt="Batch receipt full view"
              className="max-h-[80vh] w-full rounded object-contain"
            />
            {lightbox.uploadedAt && (
              <p className="px-2 pb-1 text-xs text-muted-foreground">
                Uploaded {lightbox.uploadedAt.toDate().toLocaleString('en-GB')}
                {lightbox.uploadedBy ? ` by ${lightbox.uploadedBy}` : ''}
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
