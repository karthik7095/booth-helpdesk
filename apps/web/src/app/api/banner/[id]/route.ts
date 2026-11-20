import { getToken } from "@/lib/session";

const baseUrl = process.env.API_URL ?? "http://localhost:4000";

/** Proxies the banner so an <img> can show it without handling the admin token. */
export async function GET(_request: Request, { params }: RouteContext<"/api/banner/[id]">) {
  const token = await getToken();

  if (!token) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  const response = await fetch(
    `${baseUrl}/api/admin/assemblies/${encodeURIComponent(id)}/banner`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );

  if (!response.ok) return new Response("Not found", { status: response.status });

  return new Response(response.body, {
    headers: {
      "content-type": response.headers.get("content-type") ?? "image/png",
      "cache-control": "no-cache",
    },
  });
}
