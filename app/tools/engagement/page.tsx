import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import AdminEngagementClient from './AdminEngagementClient'

// Open to any authed user. Regular users land here from /tools with a
// default include-presenter filter pre-applied via URL query; they can
// remove it like any other chip. No server-side scope enforcement —
// engagement data is shared across the team.
export default async function EngagementPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  return <AdminEngagementClient />
}
