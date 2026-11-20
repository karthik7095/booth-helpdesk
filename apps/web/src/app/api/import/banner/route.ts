import { NextResponse } from "next/server";

import { getToken } from "@/lib/session";

const baseUrl = process.env.API_URL ?? "http://localhost:4000";

/**
 * Forwards a constituency image to the API. It goes through a route handler
 * rather than a Server Action because images exceed the 1MB action body limit.
 *
 * `kind` picks the home-screen banner, the printer cover image or the WhatsApp
 * image; they are stored and versioned separately.
 */
export async function POST(request: Request) {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ message: "Your admin session has expired." }, { status: 401 });
  }

  const { assemblyId, dataUrl, kind } = (await request.json()) as {
    assemblyId?: string;
    dataUrl?: string;
    kind?: "banner" | "slip" | "whatsapp";
  };

  if (!assemblyId || !dataUrl) {
    return NextResponse.json({ message: "Missing constituency or image." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/admin/assemblies/${encodeURIComponent(assemblyId)}/${
        kind === "slip" ? "slip-image" : kind === "whatsapp" ? "whatsapp-image" : "banner"
      }`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ dataUrl }),
      },
    );

    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ message: `Can't reach the API at ${baseUrl}.` }, { status: 502 });
  }
}
