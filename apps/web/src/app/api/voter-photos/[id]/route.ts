import { NextResponse } from "next/server";

import { getToken } from "@/lib/session";

const baseUrl = process.env.API_URL ?? "http://localhost:4000";

/**
 * Forwards a zip of voter photos (<EPIC>.jpg) to the API. A route handler, not
 * a Server Action: a constituency's photos run to tens of MB, far past the
 * 1 MB Server Actions take.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/voter-photos/[id]">) {
  const token = await getToken();

  if (!token) return NextResponse.json({ message: "Your admin session has expired." }, { status: 401 });

  const { id } = await params;
  const body = await request.arrayBuffer();

  try {
    const response = await fetch(`${baseUrl}/api/admin/assemblies/${encodeURIComponent(id)}/voter-photos`, {
      method: "POST",
      headers: { "content-type": "application/zip", authorization: `Bearer ${token}` },
      body,
    });

    return NextResponse.json(await response.json().catch(() => ({ message: "Upload failed." })), { status: response.status });
  } catch {
    return NextResponse.json({ message: `Can't reach the API at ${baseUrl}.` }, { status: 502 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/voter-photos/[id]">) {
  const token = await getToken();

  if (!token) return NextResponse.json({ message: "Your admin session has expired." }, { status: 401 });

  const { id } = await params;
  const response = await fetch(`${baseUrl}/api/admin/assemblies/${encodeURIComponent(id)}/voter-photos`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });

  return new Response(null, { status: response.status });
}
