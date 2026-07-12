import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { ChevronLeft, CreditCard, LayoutGrid, DoorOpen, RefreshCw, Settings, Users, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateRange } from '@/lib/dates'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { CampDataProvider, useCampData } from './CampDataContext'

function CampLayoutInner() {
  const { id: campId } = useParams<{ id: string }>()
  const { camp, loading, refresh } = useCampData()

  const base = `/admin/camps/${campId}`

  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b bg-background px-4 pb-0 pt-4 sm:px-6">
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
            <h1 className="font-display text-2xl font-semibold leading-tight">{camp?.name ?? '…'}</h1>
            {camp && (
              <p className="text-sm text-muted-foreground">
                {formatDateRange(camp.startDate, camp.endDate)} · {camp.location}
                {' · '}
                <Link to={`${base}/dashboard`} className="text-primary hover:underline">
                  View dashboard
                </Link>
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

        {/* Sub-nav tabs — scrollable on mobile; fade hint shows more tabs exist */}
        <div className="relative -mb-px mt-4">
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent sm:hidden" />
          <nav className="flex w-full overflow-x-auto [&::-webkit-scrollbar]:hidden">
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
