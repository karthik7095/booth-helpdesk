import { getToken } from "@/lib/session";

const baseUrl = process.env.API_URL ?? "http://localhost:4000";

/** Dashboard export name → API path. Voters need the constituency in `?assemblyId=`. */
function apiPath(kind: string, params: URLSearchParams): string | null {
  switch (kind) {
    case "voters": {
      const id = params.get("assemblyId");
      return id ? `/api/admin/assemblies/${encodeURIComponent(id)}/export/voters.csv` : null;
    }
    default:
      return null;
  }
}

/**
 * Streams a CSV from the API so the browser can download it. The admin token
 * stays in its httpOnly cookie; only the file comes back.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/export/[kind]">) {
  const token = await getToken();

  if (!token) return new Response("Your admin session has expired.", { status: 401 });

  const { kind } = await params;
  const query = new URL(request.url).searchParams;
  const path = apiPath(kind, query);

  if (!path) return new Response("Unknown export.", { status: 404 });

  // Pass the page's filters (date, search) through; the id is already in the path.
  query.delete("assemblyId");
  const qs = query.toString();

  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}${qs ? `?${qs}` : ""}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return new Response(`Can't reach the API at ${baseUrl}.`, { status: 502 });
  }

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    return new Response(payload?.message ?? "Export failed.", { status: response.status });
  }

  return new Response(response.body, {
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "content-disposition": response.headers.get("content-disposition") ?? "attachment",
      "cache-control": "no-store",
    },
  });
}
