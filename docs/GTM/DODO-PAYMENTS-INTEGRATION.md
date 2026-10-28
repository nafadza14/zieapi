# Integrasi Dodo Payments & Rekening Payout Apizie

Panduan arsitektur dan konfigurasi pembayaran global Dodo Payments serta rekening bank transfer lokal untuk Apizie.

## 1. Konfigurasi Rekening Bank Payout Lokal (BCA)
Rekening resmi penerimaan pembayaran lokal dan invoice bank transfer telah dikonfigurasi langsung ke kode sumber server:
• Bank: Bank Central Asia (BCA)
• Nomor Rekening: 0374827720
• Atas Nama: Ghilman Nafadza Hakim

Teks default invoice yang muncul pada dashboard dan sistem penagihan pengguna:
`BCA 0374827720 a.n. Ghilman Nafadza Hakim`

## 2. Pendaftaran Akun Dodo Payments (Merchant of Record Global)
Untuk menerima kartu kredit internasional, Apple Pay, dan Google Pay:
1. Buka https://app.dodopayments.com/signup
2. Masukkan email: nafadza@gmail.com (atau ghilman.nh@gmail.com)
3. Buat nama bisnis: Apizie (atau ZieAds Universal API)
4. Masukkan rekening penampung payout (Bank Transfer Indonesia):
   - Bank Name: Bank Central Asia (BCA)
   - Account Number: 0374827720
   - Account Holder Name: Ghilman Nafadza Hakim

## 3. Produk di Dodo Payments (cara yang dipakai kode)
Kode memakai **satu produk "Pay What You Want"**, bukan produk per plan. Nominal tiap invoice dikirim saat checkout, jadi semua plan (bulanan, 3/6 bulan, tahunan dengan harga 10 bulan) dan top-up saldo memakai produk yang sama.
1. Dashboard Dodo → Products → Create product → One-time payment.
2. Nama: `Apizie payment`, mata uang **USD**, aktifkan **Pay What You Want**, harga minimum **$1**, kategori pajak: SaaS / digital products.
3. Salin product id (`pdt_...`) ke `DODO_PAYMENTS_PRODUCT_ID`.

Plan tidak diperpanjang otomatis (sama seperti bank transfer): pelanggan bayar lagi untuk menambah masa aktif.

## 4. Webhook
Dashboard Dodo → Developer → Webhooks → Add endpoint:
- URL: `https://<domain-kamu>/webhooks/dodo`
- Event: `payment.succeeded`, `payment.failed`, `payment.cancelled`
- Salin signing secret (`whsec_...`) ke `DODO_PAYMENTS_WEBHOOK_SECRET`.

Tanpa webhook, pembayaran tetap tercatat saat pelanggan kembali ke halaman billing (server mengecek status checkout ke Dodo), tapi webhook membuat aktivasi tidak bergantung pada itu.

## 5. Environment variables (Vercel → Settings → Environment Variables)
- `DODO_PAYMENTS_API_KEY`: API key dari Dodo (Developer → API Keys). Jangan pernah ditulis di kode, repo atau chat.
- `DODO_PAYMENTS_PRODUCT_ID`: id produk Pay What You Want di atas.
- `DODO_PAYMENTS_WEBHOOK_SECRET`: signing secret webhook.
- `DODO_PAYMENTS_ENVIRONMENT`: `live_mode` (default) atau `test_mode`. Key test hanya jalan di test mode, key live hanya di live mode.
- `APIZIE_BANK_INFO`: rekening untuk bank transfer (opsional, tetap tersedia berdampingan dengan kartu).

Setelah redeploy, buka `/admin/setup`: baris "Card payments (Dodo Payments)" harus hijau.

## 6. Alur yang berjalan
1. Pelanggan memilih plan atau top-up di `/dashboard/billing`, lalu memilih "Card, Apple Pay or Google Pay".
2. Server membuat invoice dalam USD (sen) dan sesi checkout Dodo (`POST /checkouts`) dengan `metadata.invoice_id`, lalu pelanggan diarahkan ke halaman checkout Dodo.
3. Setelah bayar, Dodo mengirim `payment.succeeded`. Server memverifikasi tanda tangan (Standard Webhooks), mencocokkan invoice, mata uang USD, nominal dan pemilik, lalu mengaktifkan plan atau menambah saldo. Event yang sama tidak diproses dua kali.
4. Saat pelanggan kembali ke `/dashboard/billing?invoice=...&checkout=done`, server juga menanyakan status ke Dodo; mana pun yang lebih dulu, aktivasi hanya terjadi sekali.
5. Pendapatan kartu muncul di `/admin` (dihitung dengan harga rupiah plan) dan invoice kartu ditandai "Card via Dodo Payments". Invoice kartu tidak bisa ditandai lunas manual.

Uji dulu dengan `DODO_PAYMENTS_ENVIRONMENT=test_mode` dan key test, pakai kartu uji Dodo, baru pindah ke live.
