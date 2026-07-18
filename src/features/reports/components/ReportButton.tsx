import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { copyToClipboard } from '@/lib/clipboard'

interface ReportButtonProps {
  /** Shown on the trigger button and as the dialog title, e.g. "Payments report". */
  label: string
  /** Pre-formatted report text (from a generator in ../generators.ts) — this component only previews/copies it. */
  reportText: string
}

/**
 * Opens a preview of a WhatsApp-formatted report with a "Copy report"
 * action. Shared by every report — adding a new report elsewhere just
 * means rendering another one of these with its own generated text.
 */
export function ReportButton({ label, reportText }: ReportButtonProps) {
  const [open, setOpen] = useState(false)
  const [copying, setCopying] = useState(false)

  async function handleCopy() {
    setCopying(true)
    try {
      const ok = await copyToClipboard(reportText)
      if (ok) {
        toast.success('Report copied')
      } else {
        toast.error('Could not copy — select and copy the text below manually')
      }
    } finally {
      setCopying(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardList className="mr-1.5 h-3.5 w-3.5 shrink-0" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>

          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm">
            {reportText}
          </pre>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            <Button className="min-h-11 sm:min-h-9" onClick={handleCopy} disabled={copying}>
              {copying ? 'Copying…' : 'Copy report'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
