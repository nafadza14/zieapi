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

## 3. Pembuatan Produk Langganan di Dodo Payments
Buat 3 produk subscription di dashboard Dodo Payments:
1. Apizie Pro Plan
   - Price: $9 USD / month
   - Quota: 25.000 requests/month
2. Apizie Ultra Plan
   - Price: $29 USD / month
   - Quota: 200.000 requests/month, bulk jobs, always-fresh cache
3. Apizie Max Plan
   - Price: $99 USD / month
   - Quota: 1.000.000 requests/month, 50 API keys

## 4. Parameter Environment Variables (Vercel)
Setelah akun Dodo Payments aktif, masukkan variabel berikut ke Vercel Settings:
• `DODO_PAYMENTS_API_KEY`: API Key dari Dodo Payments (test/live mode)
• `DODO_WEBHOOK_SECRET`: Secret key webhook untuk verifikasi signature
• `APIZIE_BANK_INFO`: BCA 0374827720 a.n. Ghilman Nafadza Hakim
