import { useMemo } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, CreditCard, LayoutGrid, DoorOpen, RefreshCw, Settings, Users, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDateRange } from '@/lib/dates'
import { derivePaymentState } from '@/features/participants/types'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { CampDataProvider, useCampData } from './CampDataContext'

function MetricCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const alert = warn && value > 0
  return (
    <div className="flex min-w-[80px] flex-col px-4 py-2">
      <div className="flex items-center gap-1">
        {alert && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />}
        <span className={`text-2xl font-semibold tabular-nums leading-none ${alert ? 'text-red-700' : ''}`}>{value}</span>
      </div>
      <span className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  )
}

function CampLayoutInner() {
  const { id: campId } = useParams<{ id: string }>()
  const { camp, participants, loading, refresh } = useCampData()

  const metrics = useMemo(() => {
    const active = participants.filter((p) => p.registrationState === 'REGISTERED')
    let paid = 0, partial = 0, pending = 0, roomed = 0, overrides = 0
    for (const p of active) {
      const ps = derivePaymentState(p)
      if (ps === 'PAID') paid++
      else if (ps === 'PARTIAL') partial++
      else if (ps === 'PENDING') pending++
      if (p.roomId) roomed++
      if (p.roomedWithoutFullPayment) overrides++
    }
    return { registered: active.length, paid, partial, pending, roomed, overrides }
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
          <div className="mt-0.5 flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading}
              title="Refresh data"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <LogoutButton />
          </div>
        </div>

        {/* Metric strip — mobile: 3×2 grid; desktop: horizontal flex */}
        {(() => {
          const metricItems = [
            { label: 'Registered', value: metrics.registered },
            { label: 'Paid',       value: metrics.paid },
            { label: 'Partial',    value: metrics.partial },
            { label: 'Pending',    value: metrics.pending },
            { label: 'Roomed',     value: metrics.roomed },
            { label: 'Overrides',  value: metrics.overrides, warn: true },
          ]
          return (
            <>
              {/* Mobile 3×2 grid */}
              <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg border sm:hidden">
                {metricItems.map((m, i) => {
                  const alert = m.warn && m.value > 0
                  return (
                    <div
                      key={m.label}
                      className={[
                        'flex flex-col items-center py-3',
                        i % 3 !== 2 ? 'border-r' : '',
                        i >= 3 ? 'border-t' : '',
                        alert ? 'bg-red-50 dark:bg-red-950/20' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-0.5">
                        {alert && <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" />}
                        <span className={`text-xl font-semibold tabular-nums leading-none ${alert ? 'text-red-700' : ''}`}>
                          {m.value}
                        </span>
                      </div>
                      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.label}
                      </span>
                    </div>
                  )
                })}
              </div>
              <Link
                to={`${base}/dashboard`}
                className="mt-1.5 inline-block text-sm text-primary hover:underline sm:hidden"
              >
                View full dashboard →
              </Link>

              {/* Desktop horizontal strip */}
              <div className="mt-4 hidden items-center overflow-x-auto sm:flex">
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
                <MetricCard label="Overrides" value={metrics.overrides} warn />
                <Separator orientation="vertical" className="h-10" />
                <Link
                  to={`${base}/dashboard`}
                  className="ml-3 whitespace-nowrap text-sm text-primary hover:underline"
                >
                  View full dashboard →
                </Link>
              </div>
            </>
          )
        })()}

        {/* Sub-nav tabs — shrink-0 on each item ensures overflow-x-auto scrolls correctly */}
        <nav className="-mb-px mt-4 flex w-full overflow-x-auto">
          {[
            { to: base, end: true, label: 'Participants', icon: Users },
            { to: `${base}/dashboard`, end: false, label: 'Dashboard', icon: LayoutGrid },
            { to: `${base}/rooms`, end: false, label: 'Rooms', icon: DoorOpen },
            { to: `${base}/leaders`, end: false, label: 'Coordinators', icon: UserCog },
            { to: `${base}/payments`, end: false, label: 'Payments', icon: CreditCard },
            { to: `${base}/settings`, end: false, label: 'Settings', icon: Settings },
          ].map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
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
