import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api";
import { getToken } from "@/lib/session";

const baseUrl = process.env.API_URL ?? "http://localhost:4000";

/** Creates (or reuses) the constituency the uploaded roll belongs to. */
export async function POST(request: Request) {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ message: "Your admin session has expired." }, { status: 401 });
  }

  const body = await request.json();

  try {
    const response = await fetch(`${baseUrl}/api/admin/imports/assembly`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json(
      { message: new ApiError(`Can't reach the API at ${baseUrl}.`, 0).message },
      { status: 502 },
    );
  }
}
