import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";

export async function requireSession(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return { email: session.user.email };
}

export function requireBearerToken(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  return token === process.env.INTERNAL_API_SECRET;
}
