import { type Resolver, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import type { CampFormValues } from '../types'

// Collapses empty string / NaN / null → undefined, then validates as optional integer
const optionalInt = (min: number) =>
  z.preprocess(
    (v) => (v === '' || v == null || (typeof v === 'number' && isNaN(v)) ? undefined : Number(v)),
    z.number().int().min(min).optional(),
  )

const schema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    location: z.string().min(1, 'Location is required'),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    minAge: optionalInt(0),
    maxAge: optionalInt(0),
    maxParticipants: optionalInt(1),
    currency: z.string().min(1, 'Currency is required'),
    registrationOpen: z.boolean(),
  })
  .refine((d) => !d.startDate || !d.endDate || d.endDate >= d.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })

// Define explicitly — z.infer returns unknown for preprocess fields
type Schema = {
  name: string
  location: string
  startDate: string
  endDate: string
  description?: string
  imageUrl?: string
  minAge?: number
  maxAge?: number
  maxParticipants?: number
  currency: string
  registrationOpen: boolean
}

interface CampFormProps {
  defaultValues?: Partial<CampFormValues>
  onSubmit: (data: CampFormValues) => Promise<void>
  submitLabel?: string
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export function CampForm({ defaultValues, onSubmit, submitLabel = 'Save' }: CampFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Schema>({
    // zodResolver output type doesn't align with explicit Schema — cast is safe at runtime
    resolver: zodResolver(schema) as Resolver<Schema>,
    defaultValues: {
      name: '',
      location: '',
      startDate: '',
      endDate: '',
      description: '',
      imageUrl: '',
      currency: 'GHS',
      registrationOpen: false,
      ...defaultValues,
    },
  })

  const registrationOpen = watch('registrationOpen')

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data as CampFormValues))} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Camp name" error={errors.name?.message}>
          <Input {...register('name')} placeholder="Summer Camp 2025" />
        </Field>
        <Field label="Location" error={errors.location?.message}>
          <Input {...register('location')} placeholder="Kumasi, Ghana" />
        </Field>
        <Field label="Start date" error={errors.startDate?.message}>
          <Input type="date" {...register('startDate')} />
        </Field>
        <Field label="End date" error={errors.endDate?.message}>
          <Input type="date" {...register('endDate')} />
        </Field>
        <Field label="Min age" error={errors.minAge?.message}>
          <Input
            type="number"
            min={0}
            {...register('minAge', { valueAsNumber: true })}
            placeholder="—"
          />
        </Field>
        <Field label="Max age" error={errors.maxAge?.message}>
          <Input
            type="number"
            min={0}
            {...register('maxAge', { valueAsNumber: true })}
            placeholder="—"
          />
        </Field>
        <Field label="Max participants" error={errors.maxParticipants?.message}>
          <Input
            type="number"
            min={1}
            {...register('maxParticipants', { valueAsNumber: true })}
            placeholder="—"
          />
        </Field>
        <Field label="Currency" error={errors.currency?.message}>
          <Input {...register('currency')} placeholder="GHS" />
        </Field>
        <Field label="Image URL" error={errors.imageUrl?.message}>
          <Input {...register('imageUrl')} placeholder="https://…" />
        </Field>
      </div>

      <Field label="Description" error={errors.description?.message}>
        <Textarea {...register('description')} rows={3} placeholder="Optional description" />
      </Field>

      {/* Registration open — blast-radius control */}
      <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 px-4 py-4 dark:border-amber-700/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <Switch
            id="registrationOpen"
            checked={registrationOpen}
            onCheckedChange={(v) => setValue('registrationOpen', v)}
            className="mt-0.5 shrink-0"
          />
          <div>
            <Label htmlFor="registrationOpen" className="font-medium">Registration open</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Closing this immediately stops all coordinators from registering new participants camp-wide.
            </p>
          </div>
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
