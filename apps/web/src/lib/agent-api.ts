import "server-only";

import type {
  BoothStats,
  BoothSummary,
  LoginRequest,
  LoginResponse,
  PinResponse,
  Session,
  Voter,
  VoterListResponse,
  VoterPatch,
  VoterSummary,
} from "@voter/shared";

import { request } from "@/lib/api";

/** The API's largest page; a booth of ~1,100 voters is fetched in a few. */
const PAGE = 200;

/** The app user's calls: the same endpoints the phone uses, with its token. */
export const agentApi = {
  login: (body: LoginRequest) => request<LoginResponse>("/api/auth/login", { method: "POST", body }),

  confirmOtp: (accessToken: string, token: string) =>
    request<{ verified: true }>("/api/auth/otp", { method: "POST", body: { accessToken }, token }),

  pin: (pin: string, token: string) =>
    request<PinResponse>("/api/auth/pin", { method: "POST", body: { pin }, token }),

  me: (token: string) => request<Session>("/api/auth/me", { token }),

  summary: (token: string) => request<VoterSummary>("/api/voters/summary", { token }),

  search: (query: { search?: string; partNo?: number; houseNo?: string; offset?: number; limit?: number }, token: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    return request<VoterListResponse>(`/api/voters?${params}`, { token });
  },

  /** Every voter on one booth, in serial order. */
  boothVoters: async (partNo: number, token: string): Promise<Voter[]> => {
    const first = await agentApi.search({ partNo, limit: PAGE }, token);
    const rest = await Promise.all(
      Array.from({ length: Math.ceil(first.total / PAGE) - 1 }, (_, i) =>
        agentApi.search({ partNo, limit: PAGE, offset: (i + 1) * PAGE }, token),
      ),
    );
    return [first, ...rest].flatMap((page) => page.voters);
  },

  booths: (token: string) => request<BoothSummary[]>("/api/voters/booths", { token }),

  boothStats: (partNo: number, token: string) =>
    request<BoothStats>(`/api/voters/booths/${partNo}`, { token }),

  voter: (id: string, token: string) => request<Voter>(`/api/voters/${encodeURIComponent(id)}`, { token }),

  update: (id: string, patch: VoterPatch, token: string) =>
    request<Voter>(`/api/voters/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, token }),

  markVoted: (id: string, hasVoted: boolean, token: string) =>
    request<Voter>(`/api/voters/${encodeURIComponent(id)}/voted`, { method: "PATCH", body: { hasVoted }, token }),

  /**
   * Logs slips as printed, through the phone's own upload so the dashboard
   * counts them the same way ("dialog": the system print dialog, not a
   * thermal printer).
   */
  recordPrints: (voters: Pick<Voter, "id" | "partNo">[], token: string) =>
    request<unknown>("/api/sync/push", {
      method: "POST",
      token,
      body: {
        changes: {
          slip_prints: {
            created: voters.map((voter) => ({
              id: crypto.randomUUID(),
              voter_id: voter.id,
              part_no: voter.partNo,
              method: "dialog",
              printed_at: Date.now(),
            })),
            updated: [],
            deleted: [],
          },
        },
      },
    }),
};
