import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { supabase } from "@/lib/db/supabase";
import { emailToName } from "@/lib/nameUtils";
import { inviteUserToVladChannel } from "@/lib/slack/inviteToChannel";
import { logEvent } from "@/lib/stats/events";
import type { UserRole } from "@/types/next-auth";

const ALLOWED_DOMAINS = ["redo.com", "getredo.com"];

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: { prompt: "select_account" },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  events: {
    async signIn({ user }) {
      if (user.email) {
        void logEvent({ type: "login", userId: user.email });
        void inviteUserToVladChannel(user.email);
      }
    },
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email;
      if (!email) return false;

      const domain = email.split("@")[1];
      if (!ALLOWED_DOMAINS.includes(domain)) return false;

      // Auto-create user in vlad_users on first login. Omits `role` so an
      // existing admin's role is preserved across re-sign-ins.
      const { firstName, lastName } = emailToName(email);
      await supabase.from("vlad_users").upsert(
        { id: email, first_name: firstName, last_name: lastName },
        { onConflict: "id" },
      );

      return true;
    },
    async session({ session, token }) {
      if (token.email && session.user) {
        session.user.email = token.email;
        session.user.role = (token.role as UserRole) ?? "user";
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
        // Role is read once at sign-in and cached on the JWT. Promoted users
        // must sign out and back in to pick up the change.
        const { data } = await supabase
          .from("vlad_users")
          .select("role")
          .eq("id", user.email)
          .single();
        token.role = (data?.role as UserRole) ?? "user";
      }
      return token;
    },
  },
};
