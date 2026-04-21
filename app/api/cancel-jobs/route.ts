import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { jobsQueue } from "@/lib/queue/connection";

export const runtime = "nodejs";

type RequestBody = { jobIds?: unknown };

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.jobIds)) {
    return NextResponse.json({ error: "jobIds must be an array." }, { status: 400 });
  }

  const jobIds = body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0);

  let cancelled = 0;
  let errors = 0;
  await Promise.all(
    jobIds.map(async (id) => {
      try {
        const job = await jobsQueue.getJob(id);
        if (!job) return;
        await job.remove();
        cancelled += 1;
      } catch {
        errors += 1;
      }
    }),
  );

  return NextResponse.json({ cancelled, errors });
}
