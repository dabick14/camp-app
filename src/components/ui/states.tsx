import { Button } from '@/components/ui/button'

// ── PageLoading ───────────────────────────────────────────────────────────────
// Full-area loading indicator. Use while data is in-flight to avoid blank or
// zero-flash screens. Keep it simple — this is an admin ops tool.
export function PageLoading({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

// ── TableSkeleton ─────────────────────────────────────────────────────────────
// Animated pulse placeholder for tables and lists.
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex animate-pulse gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, j) => (
              <div
                key={j}
                className="h-4 rounded bg-muted"
                style={{ flex: j === 0 ? 2 : 1 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────
// Dashed-border empty message. Matches the pattern already used in RoomsPage,
// LeadersPage, etc. so all empty states look like one system.
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed py-16 text-center">
      <p className="font-medium text-muted-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── PageError ─────────────────────────────────────────────────────────────────
// Caught fetch/mutation error. Always show something; never a blank screen.
// Use `onRetry` when a retry is meaningful (re-fetch). Skip it for form errors
// where the user's next action is clear without a button.
export function PageError({
  message = "Couldn't load this — check your connection and try again.",
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 py-12 text-center">
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
