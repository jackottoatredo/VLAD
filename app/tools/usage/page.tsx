import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import AdminUsageClient from './AdminUsageClient'

export default async function AdminUsagePage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== 'admin') redirect('/')

  return <AdminUsageClient />
}
