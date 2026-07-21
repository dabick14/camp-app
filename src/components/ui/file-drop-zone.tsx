import { useRef, useState } from "react"
import { FileSpreadsheet, Upload, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface FileDropZoneProps {
  id: string
  accept: string
  file: File | null
  onFileChange: (file: File | null) => void
  disabled?: boolean
  dropLabel?: string
  mobileLabel?: string
  hint?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Shared styled file picker. The native <input type="file"> stays functional
 * (sr-only, not display:none, so it's still keyboard-focusable) and is what
 * actually opens the OS file picker via its <label for="...">; drag-and-drop
 * reads dataTransfer.files directly since drop events don't reach the input.
 * Desktop shows a dashed drop zone, mobile a large tap target — both share
 * one input/state so every CSV import in the app looks and behaves the same.
 */
export function FileDropZone({
  id,
  accept,
  file,
  onFileChange,
  disabled,
  dropLabel = "Drop your CSV here, or click to browse",
  mobileLabel = "Choose CSV file",
  hint,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) onFileChange(f)
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragOver(false)
    if (disabled) return
    const f = e.dataTransfer.files?.[0]
    if (f) onFileChange(f)
  }

  function handleRemove() {
    onFileChange(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={disabled}
        className="peer sr-only"
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            disabled={disabled}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label="Remove selected file"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          {/* Desktop — dashed drop zone with drag-and-drop */}
          <label
            htmlFor={id}
            onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "hidden cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors sm:flex",
              "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-focus-visible:border-ring",
              isDragOver
                ? "border-brand bg-brand-tint"
                : "border-border bg-muted/30 hover:border-brand/50 hover:bg-muted/50",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            <Upload className={cn("h-6 w-6", isDragOver ? "text-brand" : "text-muted-foreground")} />
            <p className="text-sm font-medium text-foreground">{dropLabel}</p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </label>

          {/* Mobile — large tap target, no drag-and-drop */}
          <label
            htmlFor={id}
            className={cn(
              "flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 text-sm font-medium text-foreground transition-colors active:bg-muted sm:hidden",
              "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-focus-visible:border-ring",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            <Upload className="h-4 w-4 text-muted-foreground" />
            {mobileLabel}
          </label>
        </>
      )}
    </div>
  )
}
