import { useParams } from 'react-router-dom'

export function PublicRegistrationPage() {
  const { campId } = useParams<{ campId: string }>()

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Register</h1>
      <p className="mt-2 text-sm text-gray-500">
        Camp <code>{campId}</code> — registration form coming Day 3.
      </p>
    </div>
  )
}
