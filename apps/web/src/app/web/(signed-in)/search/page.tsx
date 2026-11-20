import { field, muted, Pager, ScreenHeader } from "@/components/agent/ui";
import { VoterRow } from "@/components/agent/voter-row";
import { agentApi } from "@/lib/agent-api";
import { requireAgent } from "@/lib/agent-session";

const PER_PAGE = 50;

export default async function AgentSearchPage({ searchParams }: PageProps<"/web/search">) {
  const { token } = await requireAgent();
  const query = await searchParams;
  const q = (Array.isArray(query.q) ? query.q[0] : query.q)?.trim() ?? "";
  const page = Math.max(1, Number(Array.isArray(query.page) ? query.page[0] : query.page) || 1);

  const result = q ? await agentApi.search({ search: q, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }, token) : null;
  const pages = result ? Math.ceil(result.total / PER_PAGE) : 0;
  const link = (to: number) => `/web/search?${new URLSearchParams({ q, page: String(to) })}`;

  return (
    <>
      <ScreenHeader title="Search" subtitle={result ? `${result.total.toLocaleString("en-IN")} voters found` : "Name, relative, voter ID, house or mobile"} />
      <main className="grid gap-4 p-4">
        <form action="/web/search">
          <input name="q" type="search" enterKeyHint="search" defaultValue={q} autoFocus={!q} placeholder="Search voters" aria-label="Search voters" className={field} />
        </form>

        {result && result.voters.length === 0 ? <p className={`py-10 text-center ${muted}`}>No voters match “{q}”.</p> : null}

        <div className="grid gap-3">
          {result?.voters.map((voter) => (
            <VoterRow key={voter.id} voter={voter} />
          ))}
        </div>

        <Pager page={page} pages={pages} href={link} />
      </main>
    </>
  );
}
