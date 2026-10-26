# Riset & penerapan metadata, SEO dan GEO (26 Okt 2026)

GEO (Generative Engine Optimization) = membuat Apizie mudah dibaca, dipahami dan **dikutip** oleh mesin jawaban AI (ChatGPT Search, Claude, Perplexity, Gemini/AI Overviews), selain tetap kuat di Google/Bing.

## 1. Riset kompetitor (dibaca langsung dari `<head>`, robots.txt dan llms.txt)

| Situs | Title & hero | Metadata | Structured data | robots / AI | llms.txt |
|---|---|---|---|---|---|
| **zapi.ink** | "Zapi: one API key for hundreds of public data sources"; hero "Every source you need. 319 scrapers. One API key." | description, keywords, canonical, OG 1200×630 + alt, Twitter large card, `googlebot max-snippet:-1`, favicon 16/32/48/96 + svg + apple 180 + mask-icon | `@graph`: Person, Organization (logo, sameAs, contactPoint), WebSite, SoftwareApplication (Offer gratis), FAQPage. Halaman API: WebPage + **WebAPI** (documentation=llms.txt, offers, keywords) + Breadcrumb, OG image per API | `Allow: /` untuk semua, sitemap dengan lastmod + image | Ya, plus llms.txt per API |
| **ApyHub** | "Certified APIs for Developers and Agents"; "1,500+ API endpoints across 400+ services" | description, canonical, OG 1200×630, Twitter | Organization, WebSite | robots.txt **menyapa agen AI** dan mengarahkan ke llms.txt / llms-full.txt; tiap halaman punya versi **Markdown** (`.md` atau `Accept: text/markdown`); blok khusus `User-agent: GPTBot` | Ya + llms-full.txt |
| **SerpApi** | "SerpApi: Google Search API" | description, keywords, canonical, OG, Twitter, favicon lengkap | Tidak ada | Disallow halaman hasil | Ya |
| **RapidAPI (Nokia API Hub)** | "API Hub" | Hampir kosong (tanpa description/OG) | Tidak ada | - | - |

Pelajaran:
1. Pemimpin kategori (zapi, ApyHub) memakai **angka konkret di judul** ("319 scrapers", "1,500+ endpoints") dan menyebut **agen AI/MCP** di hero.
2. WebAPI + FAQ + Breadcrumb per halaman API adalah pola zapi; ApyHub unggul di GEO lewat **twin Markdown** dan robots.txt yang mengarahkan agen ke llms.txt.
3. RapidAPI kehilangan sinyal SEO setelah rebrand: kesempatan untuk kueri "<nama> API".

## 2. Praktik GEO yang dipakai (dari sumber riset)
- Jawab inti pertanyaan di 100-200 kata pertama; tiap bagian berdiri sendiri karena model mengutip **potongan**, bukan halaman.
- Pernyataan spesifik berangka; studi Princeton (10.000 kueri) menemukan statistik + sitasi menaikkan visibilitas AI hingga ±40%.
- Konten penting tidak boleh bergantung pada JavaScript (banyak crawler AI tidak menjalankan JS).
- Izinkan crawler pencarian AI di robots.txt: `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`, plus token kontrol `Google-Extended`, `Applebot-Extended`.
- Google menghentikan **rich result FAQ** (7 Mei 2026), tetapi tetap membaca FAQ markup untuk memahami halaman; mesin lain dan AI masih memakai Q&A yang terlihat. Jadi FAQ tetap dipasang, dan **harus terlihat di halaman**.

## 3. Yang diterapkan di Apizie

| Area | Implementasi |
|---|---|
| Hero | Pill "New: MCP server for Claude, ChatGPT & Cursor" → `/mcp`; H1 "One API key for 1,600+ data sources"; sub-judul konkret (harga saham, gempa, berita, GitHub, Wikipedia, MCP) |
| Logo brand di hero | Hanya API berstatus **live** (difilter ulang saat render), warna asli brand (simple-icons, CC0) di tile putih: Wikipedia, GitHub, Google News, Binance, Stack Overflow, npm, PubMed, arXiv, Bluesky, The Guardian, CNN Indonesia, Deezer, Apple Music, Discord, Cloudflare DNS, Firefox Add-ons, Docker Hub, OKX, MyAnimeList, MusicBrainz |
| Favicon / address bar | Ikon baru gradien magenta→ungu dengan `//.` putih tebal, terbaca di tab terang dan gelap; `/favicon.ico` (16/32/48), `/favicon.svg`, PNG 32/96, apple-touch 180, maskable 512, manifest; cache-busting `?v=3` |
| Meta per halaman | Title unik berangka, description ≤160 karakter, canonical absolut, `robots max-snippet:-1, max-image-preview:large`, Open Graph lengkap (+ `og:locale:alternate id_ID`), Twitter large card, gambar OG 1200×630 (home, MCP, katalog/API, pricing) |
| JSON-LD | Situs: Organization, WebSite (+SearchAction ke katalog), SoftwareApplication (4 Offer IDR, featureList). Halaman API: WebPage, **WebAPI**, BreadcrumbList, FAQPage. Kategori: CollectionPage + ItemList. Docs: TechArticle. Pricing & home: FAQPage |
| Konten answer-first | Tiap halaman API punya blok "About the X API" (ringkasan berangka, tabel fakta, link OpenAPI/Markdown) + 4 FAQ yang terlihat, dirender di server |
| Twin Markdown | `/<path>.md` atau `Accept: text/markdown` untuk home, API, kategori, docs, pricing; juga `/api/<cat>/<slug>/llms.txt`. Header `X-Robots-Tag: noindex` + `Link: rel=canonical` agar tidak jadi konten duplikat |
| robots.txt | Dinamis, Sitemap absolut, menyapa agen AI, blok eksplisit untuk 16 crawler AI/pencarian, area privat (dashboard, admin, OAuth, `/v1/`) diblokir |
| Sitemap | `lastmod`, `changefreq`, `priority` (API live 0.7, lainnya 0.5) untuk ±1.700 URL |
| llms.txt | Ringkasan produk berangka, cara pakai, halaman kunci (MCP, docs, pricing, OpenAPI, llms-full.txt) |
| Halaman privat | login, register, dashboard, admin, consent OAuth, 404: `noindex, nofollow` dan tanpa JSON-LD |

## 4. Langkah setelah deploy (perlu akses akun Anda)
1. Google Search Console dan Bing Webmaster Tools: verifikasi domain, kirim `https://<domain>/sitemap.xml`.
2. Uji `https://<domain>/api/finance/binance` di Rich Results Test dan Schema Markup Validator.
3. Isi profil GitHub, npm dan direktori MCP (registry MCP, Smithery, Glama) dengan nama "Apizie" yang sama, lalu tambahkan URL-nya ke `sameAs` di `src/web/seo.js`.
4. Setelah domain final ada, set `APIZIE_PUBLIC_URL` supaya semua canonical, OG dan sitemap memakai domain itu.

## Sumber
- [AI crawler user-agent list 2026 (Anagram)](https://www.anagram.ai/blog/ai-crawler-user-agent-list-2026-14-bots-and-robotstxt-tokens-to-know)
- [Google ends FAQ rich results (TechWyse)](https://www.techwyse.com/news/ai-search/google-faq-rich-results-deprecated-2026)
- [GEO complete guide 2026 (SEOCrawl)](https://seocrawl.ai/blog/geo-complete-guide)
- Observasi langsung lewat browser: zapi.ink, apyhub.com, serpapi.com, rapidapi.com (26 Okt 2026)
