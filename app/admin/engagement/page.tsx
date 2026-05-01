import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import AdminEngagementClient from './AdminEngagementClient'

export default async function AdminEngagementPage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== 'admin') redirect('/')

  return <AdminEngagementClient />
}
