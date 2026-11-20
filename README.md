# Voter Management

npm workspaces monorepo: an Expo app for the field, a Next.js dashboard for admins, and a Fastify API over Postgres.

| Workspace | What it is |
| --- | --- |
| `apps/mobile` | Expo SDK 57 app (expo-router, gluestack-ui v5, NativeWind v5) |
| `apps/web` | Next.js 16 super-admin dashboard (shadcn/ui, Tailwind v4) |
| `apps/api` | Fastify 5 API with Prisma 7 on Postgres |
| `packages/shared` | zod schemas and TypeScript types shared by all three |

## Access model

- A **super admin** signs in to the web dashboard with email + password.
- The super admin adds **constituencies** and generates **access PINs** for them. The PIN is generated server-side from the constituency codes — `S29` + `GD` + `241` → `S29GD241B1` — and can be scoped to specific parts/booths.
- In the mobile app **anyone** signs in with a name and mobile number. That session reads nothing until an access PIN is entered; once it is, the holder sees exactly the voters of that PIN's constituency (and parts).
- Deactivating a PIN in the dashboard cuts off sessions already using it, on their next request.

## Get started

```bash
npm install
```

### 1. Database + API

```bash
createdb voter_management                 # or use an existing Postgres
cp apps/api/.env.example apps/api/.env    # set DATABASE_URL and JWT_SECRET
npm run db:migrate                        # apply migrations
npm run db:seed                           # super admin + demo constituency, PIN and voters
npm run api                               # http://localhost:4000
```

The seed prints the super admin credentials and the generated demo PIN.

### 2. Web dashboard

```bash
cp apps/web/.env.example apps/web/.env.local   # API_URL, defaults to http://localhost:4000
npm run web                                    # http://localhost:3000
```

Sign in at `/login`, then manage constituencies and PINs.

### 3. Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_API_URL
npm run mobile
```

On a physical device, point `EXPO_PUBLIC_API_URL` at your machine's LAN IP rather than `localhost`.

## API endpoints

| Endpoint | Who |
| --- | --- |
| `POST /api/admin/login`, `GET /api/admin/me`, `GET /api/admin/stats` | super admin |
| `GET/POST /api/admin/assemblies` | super admin |
| `GET/POST /api/admin/pins`, `PATCH /api/admin/pins/:id` | super admin |
| `POST /api/auth/login`, `POST /api/auth/pin`, `GET /api/auth/me` | app users |
| `GET /api/voters`, `GET /api/voters/summary`, `GET /api/voters/:id`, `PATCH /api/voters/:id/voted` | PIN holders |

## Checks

```bash
npm run typecheck       # every workspace
npm run build           # shared, api, web
```
