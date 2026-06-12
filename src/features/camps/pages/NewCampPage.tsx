import { useNavigate, Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { auth } from '@/lib/firebase'
import { dateStrToTs } from '@/lib/dates'
import { CampForm } from '../components/CampForm'
import { createCamp } from '../services/campService'
import type { CampFormValues } from '../types'

export function NewCampPage() {
  const navigate = useNavigate()

  async function handleSubmit(values: CampFormValues) {
    const uid = auth.currentUser!.uid
    const id = await createCamp(
      {
        name: values.name,
        location: values.location,
        startDate: dateStrToTs(values.startDate),
        endDate: dateStrToTs(values.endDate),
        description: values.description?.trim() || undefined,
        imageUrl: values.imageUrl?.trim() || undefined,
        minAge: values.minAge,
        maxAge: values.maxAge,
        maxParticipants: values.maxParticipants,
        currency: values.currency,
        registrationOpen: values.registrationOpen,
      },
      uid,
    )
    navigate(`/admin/camps/${id}`)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        to="/admin/camps"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All camps
      </Link>
      <h1 className="mb-6 text-2xl font-semibold">New camp</h1>
      <CampForm onSubmit={handleSubmit} submitLabel="Create camp" />
    </div>
  )
}
