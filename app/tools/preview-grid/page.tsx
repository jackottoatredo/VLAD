import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import PreviewGridClient from './PreviewGridClient'

export default async function PreviewGridPage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== 'admin') redirect('/')

  return <PreviewGridClient />
}
