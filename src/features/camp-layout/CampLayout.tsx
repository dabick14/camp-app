import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import {
  ChevronLeft, CreditCard, DoorOpen, LayoutGrid, MoreHorizontal,
  RefreshCw, Settings, TriangleAlert, Users, UserCog,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateRange } from '@/lib/dates'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { CampDataProvider, useCampData } from './CampDataContext'

const NAV_ITEMS = (base: string) => [
  { to: base,                end: true,  label: 'Participants', icon: Users      },
  { to: `${base}/dashboard`, end: false, label: 'Dashboard',    icon: LayoutGrid },
  { to: `${base}/rooms`,     end: false, label: 'Rooms',        icon: DoorOpen   },
  { to: `${base}/payments`,  end: false, label: 'Payments',     icon: CreditCard },
]

const MORE_ITEMS = (base: string) => [
  { to: `${base}/tickets`,  label: 'Issues',       icon: TriangleAlert },
  { to: `${base}/leaders`,  label: 'Coordinators', icon: UserCog  },
  { to: `${base}/settings`, label: 'Settings',     icon: Settings },
]

function MobileBottomNav({ base }: { base: string }) {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  const isMoreActive = MORE_ITEMS(base).some((item) =>
    location.pathname.startsWith(item.to),
  )

  return (
    <>
      {/* Fixed bottom bar — mobile only */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 flex border-t bg-background md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV_ITEMS(base).map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </NavLink>
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
            isMoreActive ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </div>

      {/* More sheet overlay */}
      <div
        className={`fixed inset-0 z-[38] bg-black/40 transition-opacity duration-200 md:hidden ${
          moreOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden="true"
        onClick={() => setMoreOpen(false)}
      />

      {/* More sheet panel */}
      <div
        role="dialog"
        aria-label="More options"
        aria-hidden={!moreOpen}
        className={`fixed bottom-0 left-0 right-0 z-[39] rounded-t-2xl border-t bg-background shadow-xl transition-transform duration-200 md:hidden ${
          moreOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto my-3 h-1 w-10 rounded-full bg-muted" />
        <nav className="flex flex-col gap-0.5 px-3 pb-4">
          {MORE_ITEMS(base).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-3.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary/5 text-primary' : 'text-foreground hover:bg-muted'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  )
}

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

        {/* Desktop sub-nav — hidden on mobile, which uses the bottom bar instead */}
        <div className="relative -mb-px mt-4 hidden md:block">
          <nav className="flex w-full overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {[
              ...NAV_ITEMS(base),
              { to: `${base}/tickets`,  end: false, label: 'Issues',        icon: TriangleAlert },
              { to: `${base}/leaders`,  end: false, label: 'Coordinators', icon: UserCog  },
              { to: `${base}/settings`, end: false, label: 'Settings',      icon: Settings },
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

      {/* Spacer so page content scrolls above the mobile bottom nav */}
      <div
        className="shrink-0 md:hidden"
        style={{ height: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
        aria-hidden="true"
      />

      <MobileBottomNav base={base} />
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
