# Riset kompetitor & perluasan API global (26 Okt 2026)

Tujuan: memperluas Apizie dari ~300 scraper menjadi ribuan API terintegrasi yang melayani pasar global, dengan metode yang sama seperti iterasi REA (bukti dulu, lalu rekonstruksi clean-room).

## 1. Peta kompetitor

| Pemain | Model | Skala katalog | Harga (publik) | Pelajaran untuk Apizie |
|---|---|---|---|---|
| RapidAPI (Nokia) | Marketplace terbuka, tiap penyedia set plan sendiri | Puluhan ribu API (studi yang dikutip ApyHub: 32.089 API) | Per API, ditentukan penyedia; umumnya ada plan Basic gratis lalu berjenjang | Skala besar, tapi kualitas dan format tiap API berbeda-beda. Apizie unggul di format respons seragam dan satu kuota. |
| ApyHub | Katalog utilitas milik sendiri | 1.500+ endpoint | Kredit ("atoms") | Satu kunci dan satu tagihan untuk banyak utilitas. Sama dengan arah Apizie. |
| API Ninjas | Puluhan API milik sendiri | Puluhan API | Free tier lalu plan bulanan berjenjang; sudah menyediakan MCP server | MCP sudah jadi standar baru. Apizie sudah punya MCP dengan 8 tool. |
| Apify | Platform "Actors" (scraper) + marketplace | Ribuan Actors | Berbasis compute unit, plan bulanan dengan kredit | Kuat di scraping kustom; mahal dan kompleks untuk panggilan data sederhana. |
| SerpApi | Spesialis hasil mesin pencari | Puluhan engine pencarian | Free tier kecil, lalu plan per jumlah pencarian | Nilai tinggi per vertikal sempit. Apizie menyerahkan SERP ke penyedia resmi lewat BYOK. |
| Firecrawl, ScrapingBee, Zyte, Bright Data, Oxylabs, ScraperAPI, ZenRows, Scrapfly, Diffbot, Crawlbase, Browserless, Jina | API scraping/crawling umum | Satu API, ribuan situs | Per kredit/permintaan | Fokus pada anti-bot dan proxy. Apizie sengaja **tidak** masuk ke area bypass anti-bot. |
| APIs.guru OpenAPI Directory | Direktori spesifikasi OpenAPI terbuka (CC0) | Ribuan spesifikasi | Gratis | Sumber utama untuk integrasi otomatis yang legal dan bisa dibuat ulang. |
| public-apis (GitHub) | Daftar kurasi API publik | 1.700+ entri, 51 kategori | Gratis (MIT) | Bagus untuk penemuan, tapi tanpa spesifikasi mesin. Kandidat iterasi berikutnya. |

## 2. Kesimpulan strategi
1. **Ribuan API tanpa menulis ribuan scraper.** Pakai spesifikasi OpenAPI publik, lalu jalankan semuanya lewat satu konektor generik.
2. **BYOK (bring your own key)** untuk API berbayar/berkunci. Pengguna membawa kunci penyedia sendiri, sehingga Apizie tidak menjual ulang akses dan tidak melanggar ketentuan penyedia.
3. **Satu kontrak**: pola `/v1/{category}:{api}/{endpoint}`, envelope `{project,data,timestamp}`, kuota, cache, bulk, webhook dan MCP yang sama untuk API lokal dan global.
4. **Tetap aman**: host upstream dikunci oleh spesifikasi, cek SSRF di setiap hop redirect, batas ukuran respons, dan kredensial tidak pernah disimpan atau dicatat.

## 3. Hasil integrasi
Sumber: `openapi-directory@1.3.17` (paket npm MIT dari APIs.guru), diimpor dengan `scripts/import-openapi.js`.

| Metrik | Nilai |
|---|---|
| Spesifikasi diperiksa | 2.639 |
| API global masuk katalog | 1.383 |
| Operasi (endpoint) global | 38.807 |
| API global tanpa kunci (langsung jalan) | 380 |
| API global dengan BYOK | 1.003 (key 518, bearer 399, basic 86) |
| Total katalog Apizie | ~1,7 rb API, ~40 rb endpoint, 37 kategori |

Yang sengaja dilewati: control plane cloud (Azure, AWS, Microsoft, Kubernetes, Autotask) 1.099 spesifikasi, spesifikasi tanpa server absolut 126, varian GitHub Enterprise 16, server privat 10. Tiap API maksimal 300 operasi.

Contoh API global yang kini ada: GitHub, Stripe, Twilio, Spotify, SendGrid, Slack, Trello, Zoom, Vimeo, Box, Bitbucket, Asana, Mailchimp, NASA, New York Times, xkcd, dan ratusan data pemerintah (data.gov, Inggris, India, dll).

## 4. Batasan
- Spesifikasi APIs.guru bisa lebih tua dari API aslinya. Endpoint yang berubah akan mengembalikan error dari penyedia (dipetakan ke 400/502, dan 5xx di-refund).
- Beberapa spesifikasi tidak mencantumkan skema auth padahal API-nya butuh kunci. Konektor tetap meneruskan `x-upstream-key` sebagai Bearer bila dikirim.
- OAuth interaktif tidak didukung. Pengguna mengirim access token yang sudah jadi.
- Selalu cek ketentuan tiap penyedia sebelum memakai kunci bersama (`APIZIE_UPSTREAM_KEY_*`).

## Sumber
- [RapidAPI: Plans & Pricing docs](https://docs.rapidapi.com/docs/plans-pricing-advanced-options), [PricingSaaS: RapidAPI](https://pricingsaas.com/companies/rapidapi)
- [ApyHub vs RapidAPI](https://apyhub.com/blog/apyhub-vs-rapidapi), [ApyHub: guide AI API marketplaces 2026](https://apyhub.com/blog/ultimate-guide-ai-api-marketplaces-2026)
- [API Ninjas pricing](https://www.api-ninjas.com/pricing)
- [Capterra: Apify pricing](https://www.capterra.com/p/150854/Apify/pricing/), [Apify review 2026](https://automationatlas.io/answers/apify-review-2026/)
- [CostBench: SerpApi pricing](https://costbench.com/software/ai-search-apis/serpapi-search/)
- [PageCrawl: Best Web Scraping APIs 2026](https://pagecrawl.io/blog/best-web-scraping-apis-2026)
- [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory)
