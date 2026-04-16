import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { supabase } from "@/lib/db/supabase";
import { emailToName } from "@/lib/nameUtils";

const ALLOWED_DOMAINS = ["redo.com", "getredo.com"];

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email;
      if (!email) return false;

      const domain = email.split("@")[1];
      if (!ALLOWED_DOMAINS.includes(domain)) return false;

      // Auto-create user in vlad_users on first login
      const { firstName, lastName } = emailToName(email);
      await supabase.from("vlad_users").upsert(
        { id: email, first_name: firstName, last_name: lastName },
        { onConflict: "id" },
      );

      return true;
    },
    async session({ session, token }) {
      if (token.email && session.user) session.user.email = token.email;
      return session;
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },
  },
};
