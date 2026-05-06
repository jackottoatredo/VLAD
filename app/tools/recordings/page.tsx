import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import AdminRecordingsClient from './AdminRecordingsClient'

export default async function AdminRecordingsPage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== 'admin') redirect('/')

  return <AdminRecordingsClient />
}
