# Laporan REA: zapi.ink

> Metodologi: REA (morluto/rea v6.8.0) — reverse engineering berbasis bukti.
> Tanggal capture: 26 Oktober 2026. Semua klaim mengutip `E##` dari [`evidence/index.json`](evidence/index.json).
> Cakupan: hanya permukaan publik. Tidak login, tidak memakai fitur berbayar, tidak brute-force endpoint.
> Satu-satunya API key yang dikirim adalah key palsu `zpi_invalid_probe` untuk melihat bentuk error 401.

---

## 1. Ringkasan eksekutif

Zapi (zapi.ink, sebelumnya `zpi.web.id`) adalah **gateway API scraper terkelola** dengan fokus Indonesia: satu API key, satu pola URL `/v1/{category}:{scraper}/{endpoint}`, satu envelope JSON, untuk 318 scraper / 1.270 endpoint di 25 kategori (E01, E05). Frontend adalah Next.js App Router di belakang Cloudflare (E17). Backend (`zpi-backend`) melayani REST `/v1` dan katalog publik `/api/*` di `api.zapi.ink`, plus server MCP stateless di `mcp.zapi.ink` (E03, E16, E19). Monetisasi berbasis kuota bulanan + rate per menit per plan, dibayar dalam Rupiah (E02).

---

## 2. Observations (fakta yang didukung bukti)

### 2.1 Permukaan publik (A1)
- Rute: `/`, `/scrapers`, `/pricing`, `/docs`, `/mcp`, `/showcase`, `/login`, `/register`, `/dashboard`, `/api/{category}/{scraper}`, `/openapi.json`, `/llms.txt`, `/report`, `/terms`, `/privacy`, `/cookies`, `/aup`, `/refund` (E04, E17).
- Klaim produk: 318 scraper, 25 kategori, 1.270 endpoint, 600 request gratis/bulan tanpa kartu kredit (E01).
- Login: Google, GitHub, Discord (E26). Email disebut di halaman beranda (E01).
- Plan (E02):

| Plan | Harga | Req/bulan | Req/menit | Log | Cache control | Fitur ekstra |
|---|---|---|---|---|---|---|
| Free | Rp0 | 600 | 100 | 7 hari | — | MCP, dashboard |
| Pro | Rp49.000 | 25.000 | 2.000 | 30 hari | hingga 30 dtk | webhook kuota, IP whitelist |
| Ultra | Rp129.000 | 200.000 | 5.000 | 90 hari | selalu fresh | bulk, request log |
| Max | Rp399.000 | 1.000.000 | 15.000 | 90 hari | selalu fresh | bulk, log tiap call |

- Aturan kuota: error 5xx tidak dihitung, 4xx dihitung; reset tanggal 1 UTC; header `X-RateLimit-Remaining-Month` (E02).

### 2.2 Frontend (A2)
- Next.js App Router + Turbopack (`/_next/static/chunks/turbopack-*.js`, `self.__next_f`, tanpa `__NEXT_DATA__`) (E17).
- Library terdeteksi lewat string di chunk: Radix UI, lucide, framer-motion, sonner, Sentry (`NEXT_PUBLIC_SENTRY_DSN`) (E17).
- Analitik: GA4 via GTM, Microsoft Clarity, Yandex Webmaster, Cloudflare RUM; endpoint `/api/internal/vitals` (E17).
- Storage browser di halaman publik: cookie `_ga*` saja, `localStorage` kosong (E17).
- Gambar: imgproxy bertanda tangan di `imp.zapi.ink`, objek asli di `s3.zapi.ink/main/...` (E18).
- Chunk publik **tidak** berisi URL `api.zapi.ink` — halaman katalog di-render server (RSC) (E17).

### 2.3 Kontrak REST (A3)
- Base: `https://api.zapi.ink`. Auth: header `x-api-key` (E05, E07).
- Eksekusi: `GET /v1/{category}:{scraper}/{endpoint}?param=…` atau `POST` dengan body JSON (E06, E08, E11).
- Path template: endpoint boleh punya `pathTemplate` seperti `:username` → `/v1/social-media:instagram-scraper/profile/{username}` (E11, E20).
- **Envelope sukses**: `{ project, data, timestamp }` (E01, E07, E11).
- **Envelope katalog/error**: `{ content, message, errors }` (E07, E19, E23).
- 401: `{"content":null,"message":"Invalid API key","errors":[]}` (E23).
- Bentuk error lain (E09, E10):
  - 400 exec error: `{ project, error, errors?, context?, timestamp }`
  - 400 invalid params: `message: "Invalid params"`, `errors: [{ path, message }]`
  - 403 plan gate: `error: { code, message }`, `upgrade_url`, plan minimal
  - 405: `content.expected` + header `Allow`
  - 429: `content: { limit, used, window, retryAfterSec }` + header `Retry-After`; varian kuota bulk `error.code = "quota_exceeded"`
  - bulk: `error.code` = `bulk_cap_exceeded` (400) / `bulk_not_enabled` (403); 422 idempotency conflict
- Header: `x-request-id` (dibaca SDK), `X-Response-Time` (teramati), `Idempotency-Key` (dikirim SDK), `X-RateLimit-Limit-Minute` / `X-RateLimit-Remaining-Minute` (fixture SDK) (E10, E11, E19, E27).
- Kode error bulk/plan dari fixture backend: `plan_upgrade_required`, `bulk_not_enabled`, `bulk_cap_exceeded`, `idempotency_key_reuse`, `quota_exceeded` (E27).
- Bulk: `POST /v1/{cat}:{scraper}/{endpoint}/bulk`, `GET /v1/bulk/{jobId}`; status job `QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED` (E08, E13).
- Webhook: `X-Zpi-Signature` = HMAC-SHA256 hex atas raw body, payload `{ id, event, data, deliveredAt }`, 10 jenis event (E14).

### 2.4 Katalog publik (tanpa auth)
- `GET /api/public/categories` → array `{ slug, displayName, iconUrl, color, description }` (E12, live).
- `GET /api/scrapers/list?q&cat&cursor&limit` → `{ items, nextCursor, total }`, `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300` (E19, E24).
- `GET /api/scrapers/{slug}` → detail + `endpoints[]` (`method`, `paramsSchema`, `cacheTtl`, `pathTemplate`, `exampleResponse`, `minPlan`, `bulkEnabled`) (E20).
- `GET /api/public/scrapers/{slug}/endpoints/{ep}/schema` → `fields[{ name, type, required, description, example, in, min }]` (E21).
- `GET /api/public/scrapers/{slug}/stats` → `{ requests, successRate }` (E22).
- ID entitas berformat ULID (E19).

### 2.5 MCP
- `https://mcp.zapi.ink/mcp`, Streamable HTTP stateless, protokol `2025-06-18`, server `zapi` v1.2.0 (E03, E15).
- Auth: `Authorization: Bearer`, `x-api-key`, atau `api-key` (E03).
- 8 tools: `search_scrapers`, `get_scraper_schema`, `list_categories`, `run_scraper`, `get_account`, `get_usage`, `bulk_submit`, `bulk_status`. Tidak ada resources/prompts. Bulk hanya Ultra/Max (E03).

### 2.6 Domain (A4)
- Kategori terbesar per endpoint: Finance 501, Social Media 98, Jobs 96, Research 82, Marketplace 66, Indonesia 65 (E05).
- Scraper terpopuler: Pluang (3,1 jt call), IDX (1,4 jt), TradingView, Stockbit, TikTok, Investing (E01, E04).
- Sumber Indonesia: IDX, Stockbit, KSEI, Kontan, IDX Channel, EmitenNews, Pluang, BPOM, Halal, Kode Pos, LPSE, Perpusnas, Bimas Islam (E04, E06).

---

## 3. Peta arsitektur

```
            ┌──────────────── Cloudflare (CDN, RUM) ─────────────────┐
Browser ──► │ zapi.ink  : Next.js App Router (RSC, Turbopack)         │
            │   /scrapers /pricing /docs /mcp /dashboard /login       │
            │   /openapi.json /category/*/openapi.json /llms*.txt     │
            └───────────────┬─────────────────────────────────────────┘
                            │ server-side fetch (inferensi)
Dev / SDK ──► api.zapi.ink ─┼─ /api/public/*  /api/scrapers/*   (katalog, publik)
                            ├─ /api/me/*                        (session better-auth)
                            ├─ /v1/{cat}:{scraper}/{ep}[/rest]   (x-api-key)
                            ├─ /v1/{cat}:{scraper}/{ep}/bulk     (Ultra/Max)
                            └─ /v1/bulk/{jobId}
AI agent  ──► mcp.zapi.ink/mcp (JSON-RPC, stateless) ──► katalog + /v1
            imp.zapi.ink (imgproxy) ◄── s3.zapi.ink (object storage)
            [black box] worker scraper, cache, metering, webhook dispatcher
```

---

## 4. Inferences (hipotesis, diberi tingkat keyakinan)

| # | Inferensi | Keyakinan | Alternatif |
|---|---|---|---|
| I1 | Backend memakai framework Node (kemungkinan Hono/Elysia) karena header `X-Response-Time` dan SDK di Bun | Rendah | Express/Fastify, atau Go |
| I2 | `nextCursor` adalah offset numerik | Sedang (E19: limit 2 → "2"; E24: limit 1 → "1") | Cursor opaque yang kebetulan numerik |
| I3 | Cache respons per endpoint dengan TTL `cacheTtl`, override per plan lewat param `ttl` | Sedang (E02 + SDK `opts.ttl` E11) | Cache hanya di edge |
| I4 | OpenAPI `Envelope {status,message,content}` sudah usang/generik; kontrak nyata adalah `{project,data,timestamp}` | Tinggi (E05 vs E01/E07/E11) | Dua envelope untuk dua generasi endpoint |
| I5 | Satu proses gateway memvalidasi param via `paramsSchema` sebelum memanggil worker | Sedang (pesan `Invalid params`, E10) | Validasi di dalam tiap scraper |
| I6 | `minPlan` di level scraper dan endpoint menghasilkan 403 plan gate | Tinggi (E12, E19) | — |
| I7 | Dashboard dan `/api/me/*` memakai better-auth session cookie | Tinggi (E16) | — |
| I8 | Gambar diunggah admin ke S3-compatible storage dengan nama `{slug}-{epochms}` | Tinggi (E18) | — |

---

## 5. Unknowns (A6 – ledger)

| ID | Pertanyaan | Penghalang | Otoritas yang dibutuhkan | Probe berikutnya (terbatas) |
|---|---|---|---|---|
| U1 | Bentuk respons `/v1` tanpa key | Fetch browser gagal (CORS) | — | `curl` dari mesin yang diizinkan ke 1 endpoint, tanpa key |
| U2 | Handshake MCP (`initialize`, `tools/list` JSON Schema argumen) | CORS dari origin halaman; butuh key | Akun Free | `claude mcp add` dengan key Free milik sendiri, catat `tools/list` |
| U3 | Header rate-limit lengkap (selain `X-RateLimit-Remaining-Month`, `Retry-After`) | Butuh key valid | Akun Free | 1 request valid, catat semua header |
| U4 | Alur pembayaran (gateway apa: Midtrans/Xendit/Tripay?) | Di balik login | Akun + persetujuan | Observasi pasif halaman billing dashboard |
| U5 | Runtime worker scraper, proxy pool, penanganan anti-bot | Server-side | Tidak bisa diakses | Tidak diprobe (di luar cakupan) |
| U6 | Batas bulk (cap item, konkurensi) | Butuh plan Ultra | Plan Ultra | Baca docs `/docs/bulk` |
| U7 | Format log request & retensi aktual | Butuh login | Akun | Observasi dashboard |
| U8 | Isi `exampleResponse` per endpoint apakah snapshot nyata | Tidak bisa dibedakan | — | Bandingkan dengan respons nyata (U3) |
| U9 | Bundle dashboard (`/dashboard`) | Hanya dimuat setelah login | Akun | `rea inspect-web-page` di dashboard sendiri |

---

## 6. Spesifikasi rekonstruksi clean-room (A5) — **zieapi**

Implementasi ada di repo ini. Prinsip: meniru **kontrak publik** dan arsitektur, **bukan** kode atau scraper proprietary.

### 6.1 Komponen
1. **Gateway** (`src/server.js`) — routing `/v1`, `/api`, `/mcp`, CORS, `x-request-id`, `X-Response-Time`.
2. **Auth & keys** (`src/auth.js`) — key `zie_…`, disimpan sebagai SHA-256, diterima di `x-api-key` / `Authorization: Bearer` / `api-key`.
3. **Plans & metering** (`src/plans.js`, `src/ratelimit.js`) — kuota bulanan (reset tgl 1 UTC), window per menit, 5xx tidak dihitung.
4. **Katalog** (`src/catalog.js`) — registry scraper → endpoint dengan `paramsSchema`, `cacheTtl`, `pathTemplate`, `minPlan`, `bulkEnabled`.
5. **Validator** (`src/validate.js`) — dari schema → `400 Invalid params`.
6. **Cache** (`src/cache.js`) — TTL per endpoint, `ttl` override dibatasi per plan.
7. **Bulk** (`src/bulk.js`) — job queue in-process + `Idempotency-Key`.
8. **Webhook** (`src/webhooks.js`) — HMAC-SHA256 `X-Zie-Signature`.
9. **MCP** (`src/mcp.js`) — 8 tool setara, JSON-RPC stateless.
10. **OpenAPI & llms.txt** dibangkitkan dari katalog.
11. **Store** (`src/store.js`) — in-memory + persistensi JSON opsional (ganti Postgres untuk produksi).

### 6.2 Model data
`User(id, email)` · `ApiKey(id, userId, hash, prefix, plan, status, ipAllowlist[])` · `Plan(id, monthly, perMinute, minCacheTtl, bulk, webhooks)` · `UsageLedger(keyId, month, count)` · `Scraper(id, category, slug, …)` · `Endpoint(id, scraperId, slug, method, fields[], cacheTtl, pathTemplate, minPlan, bulkEnabled, enabled)` · `Job(id, keyId, status, items[])` · `Webhook(keyId, url, secret, events[])`.

### 6.3 Checklist paritas REST
- [x] `GET|POST /v1/{cat}:{scraper}/{ep}[/{path}]`
- [x] Sukses `{project,data,timestamp}`; error `{content,message,errors}`
- [x] 400 invalid params / exec, 401, 403 plan gate, 404, 405 + `Allow`, 422, 429 + `Retry-After`, 503 disabled
- [x] `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Remaining-Month`, `x-request-id`, `X-Response-Time`, `X-Cache`
- [x] Katalog publik lima endpoint dengan bentuk sama (E12, E19–E22)
- [x] Bulk + idempotency
- [x] Tambahan yang tidak ada di Zapi: `GET /v1/me`, `GET /v1/usage` via API key (lihat E16)

### 6.4 Checklist paritas MCP
- [x] `initialize`, `tools/list`, `tools/call`, `ping`; protokol `2025-06-18`
- [x] 8 tool dengan nama sama; error tool memakai kode REST

### 6.5 Rencana uji
**Bukti paritas (E28):** `zpi-sdk@0.6.0` resmi dari npm, tanpa modifikasi, berjalan terhadap zieapi lokal (`examples/zpi-sdk-parity.mjs`): `run()`, auto-verb POST, path template, katalog, bulk, dan pemetaan error ke kelas yang benar.

Lihat juga `test/*.test.js` (35 tes) — envelope, tiga header auth, plan gate, 405, invalid params, rate limit menit & bulan, 5xx tidak dihitung, cache hit, bulk & idempotency, webhook signature, MCP.

### 6.6 Di luar cakupan (sengaja)
- Logika scraper pihak ketiga milik Zapi, teknik bypass captcha/anti-bot, rotasi proxy.
- Kategori "Bypass Tools" (pemendek URL/paywall) — tidak direplikasi.
- Penyalinan aset merek, teks marketing, atau ikon Zapi.

---

## 7. Next probes (terbatas, tanpa eskalasi hak)
1. Daftar akun Free sendiri → catat semua header respons `/v1` (U3) dan `tools/list` MCP (U2).
2. `rea inspect-web-page` + `rea analyze-web-bundle` pada `/dashboard` milik sendiri (U9).
3. Baca `/docs/bulk`, `/docs/webhooks`, `/docs/retries` untuk U6.

## 8. Lampiran
Indeks bukti: [`docs/evidence/index.json`](evidence/index.json) (E01–E28).

---

# Iterasi 2 — Reverse engineering seluruh website & sistem (26 Okt 2026)

Iterasi pertama hanya menghasilkan gateway API. Iterasi ini memetakan **seluruh website dan sistem** zapi.ink lalu membangun ulang semuanya sebagai **zieapi v2**, dengan desain sendiri (hero globe partikel).

## A. Observations baru

- **Peta situs (E29):** ada 84 rute publik, 16 halaman docs, 5 halaman legal, `llms.txt` dan `llms-full.txt`, OpenAPI per kategori, serta 636 halaman detail scraper `/api/{category}/{scraper}`.
- **Area login (E30):** rute `/dashboard` dengan sub-halaman `keys`, `usage`, `logs`, `billing`, `webhooks`, `settings` dan `bulk`, plus `/admin`. Semuanya redirect ke login. Tidak ada `/dashboard/invoices` atau `/dashboard/topup`.
- **Autentikasi (E31):** hanya OAuth (GitHub, Google, Discord). Tidak ada form email/password.
- **Katalog (E32):** 25 spesifikasi OpenAPI per kategori. Setelah kategori Bypass Tools dikeluarkan, ada 291 scraper dan 1.243 endpoint (1.223 GET, 20 POST).
- **Struktur halaman (E33):** susunan section pada homepage, pricing, detail scraper dan docs.

## B. Pemetaan zapi.ink → zieapi v2

| zapi.ink (teramati) | zieapi v2 |
|---|---|
| Next.js App Router + Cloudflare | Node `http` tanpa dependency, SSR template + vanilla JS; deploy ke Vercel/Docker |
| `api.zapi.ink` + `mcp.zapi.ink` (host terpisah) | Satu host: `/v1`, `/api/*`, `/mcp` |
| better-auth session, OAuth (E16, E31) | Sesi cookie (token di KV, HttpOnly, SameSite=Lax), OAuth GitHub/Google/Discord **dan** email/password (scrypt) |
| `/api/me/*` hanya untuk sesi (E16) | `/api/me/*` (sesi) **plus** `/v1/me` dan `/v1/usage` (API key) |
| Dashboard keys/usage/logs/billing/webhooks/settings/bulk (E30) | Semua halaman tersebut, ditambah overview dan panel admin (users, invoices, scrapers, reports, showcase) |
| Katalog 318 scraper | Seed dari struktur publik (E32) digabung dengan **92 scraper / 333 endpoint live** milik sendiri |
| Pembayaran (tidak teramati, U4) | Invoice transfer bank manual dengan kode unik, disetujui admin |
| Storage server-side (tidak teramati) | Lapisan KV: Memory/File (lokal) atau Upstash Redis REST (Vercel) |

## C. Batasan yang disengaja

- **Kategori Bypass Tools (27 endpoint) dan scraper `ai:bypass-ai` serta `dev-tools:cf-sitekey` tidak dibuat.** Ketiganya berfungsi untuk mengakali proteksi atau deteksi.
- **Endpoint yang butuh scraping privat atau anti-bot** (Instagram, TikTok, marketplace dan sejenisnya) hanya muncul di katalog dengan status *planned*. Status berubah menjadi *upstream* bila `ZIE_UPSTREAM_URL` diisi; pastikan dulu ketentuan penyedia upstream tersebut.
- **Tidak ada teks marketing, ikon, contoh respons, atau deskripsi zapi yang disalin.**

## D. Verifikasi

- 138 tes otomatis lulus (`npm test`): alur website, auth, API key, kuota, refund 5xx, plan gate, invoice→admin approve, bulk + idempotensi, webhook bertanda tangan, MCP, adapter upstream, format Upstash, dan uji tiap modul scraper dengan fetch tiruan.
- Uji upstream nyata dari browser pengguna (E34): **30 sumber membalas 200 dengan bentuk data yang sesuai**, 11 lainnya terjangkau tetapi tidak bisa dibaca karena CORS, dan sisanya **belum terverifikasi**.

## E. Unknowns tambahan

| ID | Pertanyaan | Penghalang |
|---|---|---|
| U10 | Isi dashboard dan admin zapi (tata letak, metrik) | Butuh login |
| U11 | Gateway pembayaran zapi | Butuh akun + transaksi |
| U12 | Sekitar 38 upstream live zieapi yang belum terverifikasi | CORS / izin situs di browser; uji dari server setelah deploy |
