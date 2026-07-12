import { cn } from '@/lib/utils'

/** Canonical page-title heading. font-display (Fraunces), text-2xl, semibold. */
export function PageTitle({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h1 className={cn('font-display text-2xl font-semibold', className)}>
      {children}
    </h1>
  )
}
