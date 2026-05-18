import { supabase } from "@/lib/db/supabase";
import { sendUserDM } from "@/lib/slack/sendUserDM";

type AdminPrefsRow = {
  user_id: string;
  vlad_users: { role: string | null }[] | null;
};

type NewUser = {
  email: string;
  firstName: string;
  lastName: string;
};

export function buildNewUserSignupText(user: NewUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const who = name ? `${name} (${user.email})` : user.email;
  return `:wave: *New VLAD signup* — ${who} just signed in for the first time.`;
}

// Fan out a Slack DM to every admin who has opted into the
// `notify_new_user_signup` stream. Fire-and-forget from the sign-in
// callback; failures here must never block sign-in.
export async function notifyAdminsOfNewSignup(user: NewUser): Promise<void> {
  const { data, error } = await supabase
    .from("vlad_user_preferences")
    .select("user_id, vlad_users!inner(role)")
    .eq("notify_new_user_signup", true)
    .eq("vlad_users.role", "admin");

  if (error) {
    console.error("notifyAdminsOfNewSignup: lookup failed", error.message);
    return;
  }

  const rows = (data as AdminPrefsRow[] | null) ?? [];
  // Defensive: don't DM the new user themselves if they were somehow
  // pre-seeded as admin (manual DB promotion + same-email re-signup).
  const recipients = rows
    .map((r) => r.user_id)
    .filter((id) => id && id !== user.email);
  if (recipients.length === 0) return;

  const text = buildNewUserSignupText(user);
  await Promise.all(
    recipients.map((email) => sendUserDM({ email, text })),
  );
}
