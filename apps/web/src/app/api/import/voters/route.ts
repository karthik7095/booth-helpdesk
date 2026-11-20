import { NextResponse } from "next/server";

import { getToken } from "@/lib/session";

const baseUrl = process.env.API_URL ?? "http://localhost:4000";

/**
 * Forwards one chunk of roll rows to the API. Chunks go through a route handler
 * rather than a Server Action because rolls are far larger than the 1MB body
 * limit Server Actions default to.
 */
export async function POST(request: Request) {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ message: "Your admin session has expired." }, { status: 401 });
  }

  const { assemblyId, rows } = (await request.json()) as { assemblyId?: string; rows?: unknown[] };

  if (!assemblyId || !Array.isArray(rows)) {
    return NextResponse.json({ message: "Missing constituency or rows." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/admin/imports/${encodeURIComponent(assemblyId)}/voters`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows }),
      },
    );

    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ message: `Can't reach the API at ${baseUrl}.` }, { status: 502 });
  }
}
