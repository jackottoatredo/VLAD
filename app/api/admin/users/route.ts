import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export type AdminUser = {
  email: string;
  firstName: string;
  lastName: string;
};

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("vlad_users")
    .select("id, first_name, last_name")
    .order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users: AdminUser[] = (data ?? []).map((r) => ({
    email: r.id as string,
    firstName: (r.first_name as string) ?? "",
    lastName: (r.last_name as string) ?? "",
  }));

  return NextResponse.json({ users });
}
