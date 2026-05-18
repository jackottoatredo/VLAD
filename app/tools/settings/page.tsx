import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import { supabase } from '@/lib/db/supabase'
import Page from '@/app/components/Page'
import HubSpotMeetingSetting from './HubSpotMeetingSetting'
import AdminUserBookingControl from './AdminUserBookingControl'
import NotificationSettings from './NotificationSettings'
import ThemeSetting from './ThemeSetting'

type UserRow = {
  book_button_mode: 'website_form' | 'hidden' | 'hubspot' | null
  hubspot_meeting_id: string | null
}

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/')
  const isAdmin = session.user.role === 'admin'

  const { data } = await supabase
    .from('vlad_user_preferences')
    .select('book_button_mode, hubspot_meeting_id')
    .eq('user_id', session.user.email)
    .maybeSingle()
  const row = (data as UserRow | null) ?? null
  const initialMode = row?.book_button_mode ?? 'website_form'
  const initialSelectedId = row?.hubspot_meeting_id ?? null

  return (
    <Page maxWidth="800px">
      <main className="flex h-full w-full flex-col gap-6 overflow-hidden rounded-2xl border border-border bg-surface p-8 shadow-md">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Settings &amp; Notifications
        </h1>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-foreground">Booking link</h2>
          <p className="text-sm text-muted">
            {isAdmin
              ? 'Pick a rep, then choose one of their HubSpot meeting links to use as your own. The selection saves to your account so leads who click "Book a meeting" on your shares land on that calendar.'
              : 'Choose what the “Book a meeting” button on your share pages does. Use one of your HubSpot meeting links to send leads straight to your calendar, or fall back to the generic website form.'}
          </p>
          {isAdmin ? (
            <AdminUserBookingControl
              initialMode={initialMode}
              initialSelectedId={initialSelectedId}
            />
          ) : (
            <HubSpotMeetingSetting
              initialMode={initialMode}
              initialSelectedId={initialSelectedId}
            />
          )}
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-lg font-medium text-foreground">Notifications</h2>
          <p className="text-sm text-muted">
            Slack DMs when leads engage with your shares. All on by default.
          </p>
          <NotificationSettings isAdmin={isAdmin} />
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-lg font-medium text-foreground">Theme</h2>
          <p className="text-sm text-muted">
            Choose how the app looks on this device.
          </p>
          <ThemeSetting />
        </section>
      </main>
    </Page>
  )
}
