# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code for `apps/mobile`.

# Next.js HAS CHANGED

`apps/web` runs Next.js 16. Read the relevant guide in `node_modules/next/dist/docs/` before writing code there. `cookies()` is async, route types like `LayoutProps<"/">` are generated (`next typegen`), and `middleware.ts` is now `proxy.ts`.

# Repository layout

npm workspaces monorepo:

- `apps/mobile` — Expo SDK 57 app (expo-router, gluestack-ui v5 on NativeWind v5). Routes in `src/app`, UI primitives in `src/components/ui`, theme tokens in `src/global.css`.
- `apps/web` — Next.js 16 super-admin dashboard (shadcn/ui "radix-nova", Tailwind v4). It never touches the database; it calls the API with the admin JWT held in an httpOnly cookie.
- `apps/api` — Fastify 5 + Prisma 7 (Postgres). Entry `src/server.ts`, routes in `src/routes`, schema in `prisma/schema.prisma`.
- `packages/shared` — zod schemas and types shared by all three (`@voter/shared`). Built to `dist` on install via its `prepare` script; rebuild with `npm run build -w @voter/shared` after editing.
- `packages/roll-converter` — plain-Node OCR pipeline (`@voter/roll-converter`) that turns electoral-roll PDFs into Excel voter lists (tesseract.js + sharp + exceljs + pdfjs-dist/@napi-rs/canvas for text PDFs). Formats: scanned ECI rolls in Marathi, English or Telugu (`src/convert.mjs`, language from the file name token or the cover title; label sets in `parse.mjs` and `cover.mjs`; ~150 dpi scans are upscaled before OCR) AP SEC Telugu ward lists (`src/formats/ap-ulb.mjs`, text layer + OCR) and AP SEC gram panchayat lists with photos (`src/formats/ap-gp.mjs`: ward from each page header, booth from the middle number of `అ.ఓ.జా.వ.సం. 123 - 27 - 182`; its workbook adds a `roll import` sheet the dashboard imports directly, with `WARD_NO`). CLI: `npm run roll:convert -- roll.pdf`; models: `npm run roll:models` (mar, tel, eng); tests: `npm run roll:test`.
- `services/ocr` — self-hosted OCR service (Python, Surya 0.14 on CPU in bfloat16) for the desktop app's **Cloud** tab. It runs on the production server as `voter-ocr.service` on 127.0.0.1:4500 only, as the `voter-ocr` user, capped at 3.5 GB / 3 cores (it loads at ~2.9 GB; float32 does not fit). The API's `POST /api/ocr/recognize` (`routes/ocr.ts`) checks the desktop licence and proxies to it (`OCR_URL`). In cloud mode the converter still reads every box on-device and sends only boxes with blank, warned or Latin-junk fields, 3 per request (~20 s per box on this CPU; Apache cuts proxied requests at 120 s); replaced fields are listed in the review sheet. Deploy with `npm run deploy:ocr`; test without a licence via an SSH tunnel and `roll:convert -- roll.pdf --cloud-url http://127.0.0.1:<port>`. Surya 0.15+ is a llama.cpp VLM: do not upgrade on this server.
- `apps/desktop` — Electron wrapper around the converter (`npm run desktop`, `npm run desktop:build`). Device-licensed: activation codes and computers are managed on the dashboard's `/devices` page via `/api/admin/activation-codes` and `/api/admin/devices`; the app calls `/api/devices/activate` and `/api/devices/check` (`src/license.mjs`). ESM main process: never top-level `await app.whenReady()`, Electron defers `ready` until the entry module finishes evaluating.

# Production URLs

The dashboard is served at `https://voters.iramediaconcepts.com` and the API at `https://voters.iramediaconcepts.com/backend` (Apache proxies `/backend/` to the API on port 4000 and everything else to the dashboard on port 3000; `scripts/setup-domain.sh` sets both up). The mobile and desktop apps use the `/backend` URL. The dashboard's own `/api/*` Next.js routes are not the API. Port 4000 is also open directly for older app builds. The server's firewall is nftables managed by Webmin (`/etc/webmin/nftables/rules.conf`).

**This folder is the Booth Help Desk copy** of the IRA Media project (`../voter-managment`). It deploys only to the Booth Help Desk environment on the same server: `https://voters.nabeenmultimedia.com` (+ `/backend`), `/opt/booth-helpdesk`, `booth-api` (127.0.0.1:4001) and `booth-web` (127.0.0.1:3001), database `booth_helpdesk`. Those settings are in `.deploy.env`; `npm run deploy:prod` and `npm run domain:setup` use them. The mobile app is `com.boothhelpdesk.app` on EAS update channel `booth` (same EAS project as IRA Media — never publish to `production` from here); build the APK with `npm run mobile:apk`.

Run everything from the repo root: `npm run api`, `npm run web`, `npm run mobile`, `npm run typecheck`.

# Access model

Super admins issue access PINs per constituency; app users sign in with name + mobile, then enter a PIN to unlock exactly that constituency's voters. There are no booth-agent accounts — the PIN is the credential.

A third role, `developer`, is hidden: it is never listed, it passes every super-admin check, and it alone can reach licence management (`requireDeveloper` answers 404 to everyone else). Create one with `npm exec -w @voter/api -- tsx scripts/create-admin.ts <email> <password> developer`.

When a constituency is onboarded, the super admin can also create constituency admin logins (`AdminUser.role = constituency_admin`, tied to `assemblyId`). They use the same web dashboard but the API limits them to that one constituency: every `/api/admin/assemblies/:id...` route is checked in a hook in `routes/admin.ts`, and routes that span constituencies (create/delete constituency, imports, admin management) use `requireSuperAdmin`.

# App user approval

Per constituency (`AppUserAccess`, `lib/app-user-access.ts`): with **Login approval** on (App features, `requireLoginApproval`), a user who enters a correct PIN is filed `pending` and the PIN is not attached (`APPROVAL_PENDING`; the app shows "Waiting for approval") until an admin approves them. At most `maxAppUsers` (per constituency, default 5, set by a super admin on the App users card) are `approved` at once, app admins included, approval on or off: with approval off a new user is approved on the spot while there is room and refused (`LOGIN_LIMIT_REACHED`) once it is full. The `20261109120000_app_user_limit` migration recorded everyone signed in at that time as approved, even past the limit. `removed` users are refused this constituency's PINs approval on or off (`ACCESS_REMOVED`: the app signs out and wipes the roll) until **Allow again** (back to `pending`). In a constituency whose voters carry `wardNo`, approving (and `make-admin`) needs the wards the person may download (`wardNos`, empty = all; `set-wards` changes it): `AppUserAccess.wardNos` goes into `access.wardNos`, every voter/sync query is fenced to it, and the seed/pull report it as `wardScope` so a phone whose wards changed downloads again. With approval off, users get every ward. Every request re-checks in `plugins/auth.ts` (in-memory cache, 60 s reload). Admins decide on the constituency page's **App users** card (`/api/admin/assemblies/:id/app-users`) and mark **app admins**, who approve, remove and allow again from the app's Approvals screen (`/api/voters/app-users`), never themselves or other admins. The dashboard can also mark one or more app admins **Mayor** (`isMayor`, `make-mayor`/`unmake-mayor`, dashboard only; a Mayor gets every ward): a Mayor manages everyone but themselves and other Mayors from the app, admins included, and makes or unmakes admins there.

# Gram panchayats

A constituency with `isPanchayat` (dashboard: App features › Gram panchayat) is a panchayat: voters carry `wardNo` (import column `WARD_NO`), the app's Booths screen lists wards beside booths, and each ward has a slip print banner (`WardPrintBanner`, files in `apps/api/.uploads/ward-banners`) that any app user holding the panchayat's PIN can upload from Settings (`/api/voters/wards/:wardNo/print-banner`). A voter's slip prints their ward's banner in place of the constituency cover; a ward without one falls back to it. In Settings, PIN holders type the slip header instead of designing it: the heading and vote line and the Sarpanch candidate (name + party symbol, once per panchayat; columns on `assemblies`), and each ward's member candidate (`WardCandidate`, `/api/voters/panchayat-slip`, `/api/voters/wards/:wardNo/candidate` and `/symbol`). The phone draws each ward's header (`components/slip-header-renderer.tsx`, react-native-svg, 576 px) and uploads it as that ward's print banner; changing the Sarpanch redraws every ward.

# Prisma 7 notes

The generator is `prisma-client` (not `prisma-client-js`), the client is generated to `apps/api/src/generated/prisma`, the datasource block has no `url` (the connection string lives in `prisma.config.ts` and in the `PrismaPg` adapter), and `PrismaClient` requires a driver adapter.
