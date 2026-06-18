import { useMemo } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { ChevronLeft, CreditCard, LayoutGrid, DoorOpen, RefreshCw, Settings, Smartphone, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDateRange } from '@/lib/dates'
import { derivePaymentState } from '@/features/participants/types'
import { CampDataProvider, useCampData } from './CampDataContext'

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-[72px] flex-col px-4 py-2">
      <span className="text-2xl font-semibold tabular-nums leading-none">{value}</span>
      <span className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  )
}

function CampLayoutInner() {
  const { id: campId } = useParams<{ id: string }>()
  const { camp, participants, loading, refresh } = useCampData()

  const metrics = useMemo(() => {
    const active = participants.filter((p) => p.registrationState === 'REGISTERED')
    let paid = 0, partial = 0, pending = 0, roomed = 0
    for (const p of active) {
      const ps = derivePaymentState(p)
      if (ps === 'PAID') paid++
      else if (ps === 'PARTIAL') partial++
      else if (ps === 'PENDING') pending++
      if (p.roomId) roomed++
    }
    return { registered: active.length, paid, partial, pending, roomed }
  }, [participants])

  const base = `/admin/camps/${campId}`

  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b bg-background px-6 pb-0 pt-4">
        {/* Back link */}
        <Link
          to="/admin/camps"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          All camps
        </Link>

        {/* Camp heading + refresh */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold leading-tight">{camp?.name ?? '…'}</h1>
            {camp && (
              <p className="text-sm text-muted-foreground">
                {formatDateRange(camp.startDate, camp.endDate)} · {camp.location}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
            title="Refresh data"
            className="mt-0.5 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Metric strip */}
        <div className="mt-4 flex items-center gap-0 overflow-x-auto">
          <MetricCard label="Registered" value={metrics.registered} />
          <Separator orientation="vertical" className="h-10" />
          <MetricCard label="Paid" value={metrics.paid} />
          <Separator orientation="vertical" className="h-10" />
          <MetricCard label="Partial" value={metrics.partial} />
          <Separator orientation="vertical" className="h-10" />
          <MetricCard label="Pending" value={metrics.pending} />
          <Separator orientation="vertical" className="h-10" />
          <MetricCard label="Roomed" value={metrics.roomed} />
          <Separator orientation="vertical" className="h-10" />
          <Link
            to={`${base}/dashboard`}
            className="ml-3 whitespace-nowrap text-sm text-primary hover:underline"
          >
            View full dashboard →
          </Link>
        </div>

        {/* Sub-nav tabs */}
        <nav className="-mb-px mt-4 flex overflow-x-auto">
          {[
            { to: base, end: true, label: 'Participants', icon: Users },
            { to: `${base}/dashboard`, end: false, label: 'Dashboard', icon: LayoutGrid },
            { to: `${base}/rooms`, end: false, label: 'Rooms', icon: DoorOpen },
            { to: `${base}/payments`, end: false, label: 'Payments', icon: CreditCard },
            { to: `${base}/hubtel-transactions`, end: false, label: 'Hubtel', icon: Smartphone },
            { to: `${base}/settings`, end: false, label: 'Settings', icon: Settings },
          ].map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  )
}

export function CampLayout() {
  const { id: campId } = useParams<{ id: string }>()
  return (
    <CampDataProvider campId={campId!}>
      <CampLayoutInner />
    </CampDataProvider>
  )
}
