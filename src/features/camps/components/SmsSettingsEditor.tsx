import { useCallback, useEffect, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { countSmsSegments } from '@/features/sms/lib/smsSegments'
import { listRecentSmsLog } from '@/features/sms/services/smsLogService'
import type { SmsLogEntry, SmsStatus } from '@/features/sms/types'
import { saveSmsSettings } from '../services/campService'
import type { SmsSettings } from '../types'

const DEFAULT_SENDER_ID = 'FLGALATIANS'
const DEFAULT_ASSIGNED_TEMPLATE =
  "Hi {FirstName}, you've been assigned to Room {RoomNumber} for {CampName}. See you there!"
const DEFAULT_CHANGED_TEMPLATE =
  "Hi {FirstName}, your room for {CampName} has changed. You're now in Room {RoomNumber}."

const PLACEHOLDER_HINT = 'Placeholders: {FirstName} {RoomNumber} {RoomType} {CampName}'

function currentUid() {
  const user = getAuth().currentUser
  return user?.email ?? user?.uid ?? 'admin'
}

function fmtTs(ts: SmsLogEntry['createdAt']): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const SMS_STATUS_VARIANT: Record<SmsStatus, 'paid' | 'destructive' | 'secondary' | 'partial'> = {
  SENT: 'paid',
  FAILED: 'destructive',
  SKIPPED: 'secondary',
  PENDING: 'partial',
}

function StatusBadge({ status }: { status: SmsStatus }) {
  return <Badge variant={SMS_STATUS_VARIANT[status]} className="shrink-0">{status}</Badge>
}

function TemplateField({
  label, value, onChange, defaultValue, disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  defaultValue: string
  disabled: boolean
}) {
  const info = countSmsSegments(value)
  const over = info.length > 160
  const isDefault = value === defaultValue
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className={`text-xs ${over ? 'text-status-partial font-medium' : 'text-muted-foreground'}`}>
          {info.length} chars · {info.segments} segment{info.segments === 1 ? '' : 's'}
          {over && ' (extra segments cost more)'}
        </span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={disabled}
        className="text-sm"
      />
      {isDefault ? (
        <p className="text-xs text-muted-foreground">Pre-filled with the default text — edit it above if you'd like something different.</p>
      ) : (
        <button
          type="button"
          onClick={() => onChange(defaultValue)}
          className="text-xs text-primary hover:underline disabled:opacity-50"
          disabled={disabled}
        >
          Reset to default
        </button>
      )}
    </div>
  )
}

export function SmsSettingsEditor({
  campId,
  smsSettings,
  onChange,
}: {
  campId: string
  smsSettings: SmsSettings | undefined
  onChange: (updated: SmsSettings) => void
}) {
  const [enabled, setEnabled] = useState(smsSettings?.enabled === true)
  const [senderId, setSenderId] = useState(smsSettings?.senderId ?? DEFAULT_SENDER_ID)
  // Pre-filled with real, editable default text (not left empty behind a
  // ghost placeholder) — turning the switch on and saving immediately works
  // without the admin needing to type anything first.
  const [assignedTemplate, setAssignedTemplate] = useState(smsSettings?.assignedTemplate ?? DEFAULT_ASSIGNED_TEMPLATE)
  const [changedTemplate, setChangedTemplate] = useState(smsSettings?.changedTemplate ?? DEFAULT_CHANGED_TEMPLATE)
  const [saving, setSaving] = useState(false)

  const [log, setLog] = useState<SmsLogEntry[]>([])
  const [logLoading, setLogLoading] = useState(true)
  const [logError, setLogError] = useState(false)

  const loadLog = useCallback(async () => {
    setLogLoading(true)
    setLogError(false)
    try {
      setLog(await listRecentSmsLog(campId, 30))
    } catch {
      setLogError(true)
    } finally {
      setLogLoading(false)
    }
  }, [campId])

  useEffect(() => { loadLog() }, [loadLog])

  async function handleSave() {
    const trimmedSender = senderId.trim() || DEFAULT_SENDER_ID
    if (trimmedSender.length > 11) {
      toast.error('Sender ID must be at most 11 characters.')
      return
    }
    setSaving(true)
    try {
      // Always a concrete string, never undefined — Firestore's client SDK
      // throws on `undefined` nested inside an object field (smsSettings
      // here isn't spread at the top level, so the usual stripUndefined
      // treatment elsewhere in campService doesn't reach it).
      const updated: SmsSettings = {
        enabled,
        senderId: trimmedSender,
        assignedTemplate: assignedTemplate.trim() || DEFAULT_ASSIGNED_TEMPLATE,
        changedTemplate: changedTemplate.trim() || DEFAULT_CHANGED_TEMPLATE,
      }
      await saveSmsSettings(campId, updated, currentUid())
      onChange(updated)
      toast.success('SMS settings saved.')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to save SMS settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border p-4">
          <div>
            <p className="text-sm font-medium">Send room assignment texts</p>
            <p className="text-xs text-muted-foreground">
              Emergency stop — turning this off blocks all sends immediately, no deploy needed.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={saving} />
        </div>

        {!enabled && (
          <div className="flex items-start gap-2 rounded-md border border-status-partial/30 bg-status-partial-bg px-3 py-2 text-xs text-status-partial">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            SMS is currently OFF for this camp. Room assignments still work as normal — no texts are sent.
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="sms-sender">Sender ID</Label>
          <Input
            id="sms-sender"
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
            maxLength={11}
            disabled={saving}
            placeholder={DEFAULT_SENDER_ID}
          />
          <p className="text-xs text-muted-foreground">Max 11 characters. Shown to recipients as the message sender.</p>
        </div>

        <p className="text-xs text-muted-foreground">{PLACEHOLDER_HINT}</p>

        <TemplateField
          label="Room assigned"
          value={assignedTemplate}
          onChange={setAssignedTemplate}
          defaultValue={DEFAULT_ASSIGNED_TEMPLATE}
          disabled={saving}
        />
        <TemplateField
          label="Room changed"
          value={changedTemplate}
          onChange={setChangedTemplate}
          defaultValue={DEFAULT_CHANGED_TEMPLATE}
          disabled={saving}
        />

        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save SMS settings'}
        </Button>
      </section>

      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent sends
          </p>
          <button
            type="button"
            onClick={() => loadLog()}
            className="text-xs text-primary hover:underline"
            disabled={logLoading}
          >
            Refresh
          </button>
        </div>

        {logLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
        ) : logError ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Couldn't load send log.{' '}
            <button type="button" className="underline hover:text-foreground" onClick={() => loadLog()}>
              Retry
            </button>
          </p>
        ) : log.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No sends yet.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {log.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.phone}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {entry.trigger} · {fmtTs(entry.createdAt)}
                    {entry.creditLeft !== undefined && ` · ${entry.creditLeft} credits left`}
                  </p>
                  {entry.status === 'FAILED' && entry.providerError && (
                    <p className="mt-0.5 text-xs text-destructive">{entry.providerError}</p>
                  )}
                  {entry.status === 'SKIPPED' && entry.reason && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{entry.reason}</p>
                  )}
                </div>
                <StatusBadge status={entry.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
