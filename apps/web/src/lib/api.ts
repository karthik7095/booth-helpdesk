import "server-only";

import type {
  AppUserAction,
  AppUserList,
  AccessPin,
  ActivationCode,
  CreateActivationCodeRequest,
  Device,
  UpdateActivationCodeRequest,
  UpdateDeviceRequest,
  AdminLoginResponse,
  AdminStats,
  AdminUser,
  Assembly,
  ConstituencyAdmin,
  CreateAssemblyRequest,
  CreateConstituencyAdminRequest,
  CreatePinRequest,
  PollDetails,
  PollDetailsInput,
  PrintReport,
  ResetPrintsResult,
  RollWipeImpact,
  RollWipeResult,
  StatsVisibility,
  Announcement,
  AppFeatures,
  ApplyAnnouncementResult,
  UpdateAnnouncementRequest,
  UpdateAppFeaturesRequest,
  UpdateStatsVisibilityRequest,
  UsageReport,
  AppUser,
  AppStats,
  AppStatsQuery,
  BoothStats,
  BoothSummary,
  UpdateConstituencyAdminRequest,
  VoterListQuery,
  VoterListResponse,
  WarRoomBooth,
} from "@voter/shared";

const baseUrl = process.env.API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      // The dashboard always shows current data.
      cache: "no-store",
    });
  } catch {
    throw new ApiError(`Can't reach the API at ${baseUrl}. Is it running?`, 0);
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new ApiError(
      typeof payload?.message === "string" ? payload.message : "Something went wrong.",
      response.status,
    );
  }

  return payload as T;
}

export const api = {
  // --- desktop app licensing (super admin)
  activationCodes: (token: string) => request<ActivationCode[]>("/api/admin/activation-codes", { token }),
  createActivationCode: (body: CreateActivationCodeRequest, token: string) =>
    request<ActivationCode>("/api/admin/activation-codes", { method: "POST", body, token }),
  updateActivationCode: (id: string, body: UpdateActivationCodeRequest, token: string) =>
    request<ActivationCode>(`/api/admin/activation-codes/${id}`, { method: "PATCH", body, token }),
  deleteActivationCode: (id: string, token: string) =>
    request<{ ok: true }>(`/api/admin/activation-codes/${id}`, { method: "DELETE", token }),
  devices: (token: string) => request<Device[]>("/api/admin/devices", { token }),
  updateDevice: (id: string, body: UpdateDeviceRequest, token: string) =>
    request<Device>(`/api/admin/devices/${id}`, { method: "PATCH", body, token }),
  deleteDevice: (id: string, token: string) =>
    request<{ ok: true }>(`/api/admin/devices/${id}`, { method: "DELETE", token }),

  login: (email: string, password: string) =>
    request<AdminLoginResponse>("/api/admin/login", {
      method: "POST",
      body: { email, password },
    }),

  me: (token: string) => request<AdminUser>("/api/admin/me", { token }),

  stats: (token: string) => request<AdminStats>("/api/admin/stats", { token }),

  assemblies: (token: string) => request<Assembly[]>("/api/admin/assemblies", { token }),

  assembly: (id: string, token: string) =>
    request<Assembly>(`/api/admin/assemblies/${encodeURIComponent(id)}`, { token }),

  setAppUserActive: (mobileNumber: string, active: boolean, token: string) =>
    request<{ deactivated: boolean; devices: number }>(
      `/api/admin/app-users/${encodeURIComponent(mobileNumber)}/${active ? "activate" : "deactivate"}`,
      { method: "POST", token },
    ),

  sessions: (token: string, search?: string) =>
    request<AppUser[]>(
      search ? `/api/admin/sessions?q=${encodeURIComponent(search)}` : "/api/admin/sessions",
      { token },
    ),

  setAssemblyActive: (id: string, isActive: boolean, token: string) =>
    request<{ isActive: boolean }>(`/api/admin/assemblies/${encodeURIComponent(id)}/active`, {
      method: "PATCH",
      body: { isActive },
      token,
    }),

  rollWipeImpact: (id: string, token: string) =>
    request<RollWipeImpact>(`/api/admin/imports/${encodeURIComponent(id)}/impact`, { token }),

  wipeRoll: (id: string, token: string) =>
    request<RollWipeResult>(`/api/admin/imports/${encodeURIComponent(id)}/voters`, {
      method: "DELETE",
      token,
    }),

  appStats: (query: AppStatsQuery, token: string) => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }

    return request<AppStats>(`/api/admin/app-stats?${params}`, { token });
  },

  printReport: (id: string, token: string) =>
    request<PrintReport>(`/api/admin/assemblies/${encodeURIComponent(id)}/prints`, { token }),

  resetPrints: (id: string, token: string) =>
    request<ResetPrintsResult>(`/api/admin/assemblies/${encodeURIComponent(id)}/prints`, {
      method: "DELETE",
      token,
    }),

  booths: (id: string, token: string) =>
    request<BoothSummary[]>(`/api/admin/assemblies/${encodeURIComponent(id)}/booths`, { token }),

  warRoom: (id: string, partNo: number, token: string) =>
    request<WarRoomBooth>(
      `/api/admin/assemblies/${encodeURIComponent(id)}/booths/${partNo}/war-room`,
      { token },
    ),

  boothStats: (id: string, partNo: number, token: string) =>
    request<BoothStats>(
      `/api/admin/assemblies/${encodeURIComponent(id)}/booths/${partNo}`,
      { token },
    ),

  assemblyVoters: (id: string, query: VoterListQuery, token: string) => {
    const params = new URLSearchParams(
      Object.entries(query).flatMap(([key, value]) =>
        value === undefined || value === "" ? [] : [[key, String(value)] as [string, string]],
      ),
    );

    return request<VoterListResponse>(
      `/api/admin/assemblies/${encodeURIComponent(id)}/voters?${params.toString()}`,
      { token },
    );
  },

  createAssembly: (body: CreateAssemblyRequest, token: string) =>
    request<Assembly>("/api/admin/assemblies", { method: "POST", body, token }),

  updatePollDetails: (id: string, body: PollDetailsInput, token: string) =>
    request<PollDetails>(`/api/admin/assemblies/${encodeURIComponent(id)}/poll`, {
      method: "PATCH",
      body,
      token,
    }),

  pins: (token: string, assemblyId?: string) =>
    request<AccessPin[]>(
      assemblyId ? `/api/admin/pins?assemblyId=${encodeURIComponent(assemblyId)}` : "/api/admin/pins",
      { token },
    ),

  updateStatsVisibility: (id: string, body: UpdateStatsVisibilityRequest, token: string) =>
    request<StatsVisibility>(
      `/api/admin/assemblies/${encodeURIComponent(id)}/stats-visibility`,
      { method: "PATCH", body, token },
    ),

  updateAppFeatures: (id: string, body: UpdateAppFeaturesRequest, token: string) =>
    request<AppFeatures>(`/api/admin/assemblies/${encodeURIComponent(id)}/app-features`, {
      method: "PATCH",
      body,
      token,
    }),

  voterPhotos: (id: string, token: string) =>
    request<VoterPhotoSummary>(`/api/admin/assemblies/${encodeURIComponent(id)}/voter-photos`, { token }),

  appUsers: (id: string, token: string) =>
    request<AppUserList>(`/api/admin/assemblies/${encodeURIComponent(id)}/app-users`, { token }),

  setAppUserLimit: (id: string, limit: number, token: string) =>
    request<AppUserList>(`/api/admin/assemblies/${encodeURIComponent(id)}/app-user-limit`, {
      method: "PATCH",
      body: { limit },
      token,
    }),

  appUserAction: (id: string, mobile: string, action: AppUserAction, token: string, wardNos?: number[]) =>
    request<AppUserList>(
      `/api/admin/assemblies/${encodeURIComponent(id)}/app-users/${encodeURIComponent(mobile)}/${action}`,
      { method: "POST", token, ...(wardNos ? { body: { wardNos } } : {}) },
    ),

  updateAnnouncement: (id: string, body: UpdateAnnouncementRequest, token: string) =>
    request<Announcement>(`/api/admin/assemblies/${encodeURIComponent(id)}/announcement`, {
      method: "PATCH",
      body,
      token,
    }),

  applyAnnouncementToAll: (id: string, token: string) =>
    request<ApplyAnnouncementResult>(
      `/api/admin/assemblies/${encodeURIComponent(id)}/announcement/apply-to-all`,
      { method: "POST", token },
    ),

  usage: (token: string, date?: string) =>
    request<UsageReport>(
      date ? `/api/admin/usage?date=${encodeURIComponent(date)}` : "/api/admin/usage",
      { token },
    ),

  createPin: (body: CreatePinRequest, token: string) =>
    request<AccessPin>("/api/admin/pins", { method: "POST", body, token }),

  setPinActive: (id: string, isActive: boolean, token: string) =>
    request<AccessPin>(`/api/admin/pins/${id}`, {
      method: "PATCH",
      body: { isActive },
      token,
    }),

  constituencyAdmins: (assemblyId: string, token: string) =>
    request<ConstituencyAdmin[]>(
      `/api/admin/assemblies/${encodeURIComponent(assemblyId)}/admins`,
      { token },
    ),

  createConstituencyAdmin: (
    assemblyId: string,
    body: CreateConstituencyAdminRequest,
    token: string,
  ) =>
    request<ConstituencyAdmin>(`/api/admin/assemblies/${encodeURIComponent(assemblyId)}/admins`, {
      method: "POST",
      body,
      token,
    }),

  updateConstituencyAdmin: (id: string, body: UpdateConstituencyAdminRequest, token: string) =>
    request<ConstituencyAdmin>(`/api/admin/admins/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      token,
    }),
};

/** Voter photos on the server for one constituency, bundle by bundle. */
export type VoterPhotoSummary = {
  total: number;
  voters: number;
  packs: { kind: "ward" | "part"; no: number; count: number; bytes: number; updatedAt: string }[];
};
