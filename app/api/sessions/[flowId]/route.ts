import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { deleteManyFromR2, VLAD_NAMESPACE } from "@/lib/storage/r2";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delete the raw session objects (mouse.json + webcam.webm) at
 * sessions/{userId}/{flowId}/. Called when the user discards an
 * in-progress flow that was uploaded but never draft-saved.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ flowId: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { flowId } = await params;
  if (!UUID_RE.test(flowId)) {
    return NextResponse.json({ error: "Invalid flowId." }, { status: 400 });
  }

  await deleteManyFromR2([
    `${VLAD_NAMESPACE}/sessions/${session.email}/${flowId}/mouse.json`,
    `${VLAD_NAMESPACE}/sessions/${session.email}/${flowId}/webcam.webm`,
  ]);

  return NextResponse.json({ ok: true });
}
