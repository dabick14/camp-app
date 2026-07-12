import { cn } from '@/lib/utils'

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('px-4 sm:px-6 py-6', className)}>{children}</div>
}
