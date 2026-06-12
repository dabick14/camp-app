import { useLocation, useParams } from 'react-router-dom'
import { CheckCircle } from 'lucide-react'

interface ConfirmationState {
  participantId: string
  fullName: string
  subGroupName: string
  roomTypePreferenceName: string
  feeOwed: number
  currency: string
  campName: string
}

export function ConfirmationPage() {
  const { campId: _campId } = useParams()
  const location = useLocation()
  const state = location.state as ConfirmationState | null

  if (!state) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h1 className="text-xl font-semibold">Registration complete</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You're registered. Contact your sub-group leader to arrange payment.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        <CheckCircle className="mb-3 h-14 w-14 text-green-500" />
        <h1 className="text-2xl font-semibold">You're registered!</h1>
        <p className="mt-1 text-sm text-muted-foreground">{state.campName}</p>
      </div>

      <div className="rounded-lg border p-4 space-y-3 text-sm">
        <Row label="Name" value={state.fullName} />
        <Row label="Sub-group" value={state.subGroupName} />
        <Row label="Room preference" value={state.roomTypePreferenceName} />
        <Row
          label="Fee owed"
          value={`${state.currency} ${state.feeOwed.toLocaleString()}`}
          highlight
        />
      </div>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium mb-1">Next steps</p>
        <p>
          Pay your fee to your sub-group leader. They will collect payments and submit them to
          the camp administration on your behalf. Keep a record of your payment.
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Screenshot or save this page for your records.
        <br />
        Reference: <span className="font-mono">{state.participantId}</span>
      </p>
    </div>
  )
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? 'font-semibold' : 'font-medium'}>{value}</span>
    </div>
  )
}
