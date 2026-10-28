# Integrasi Pembayaran Global Lemon Squeezy untuk Apizie

Panduan teknis aktivasi pembayaran internasional (kartu kredit, PayPal, Apple Pay, Google Pay) menggunakan Lemon Squeezy sebagai Merchant of Record (MoR) tanpa memerlukan badan hukum US LLC.

## 1. Keunggulan Lemon Squeezy untuk Apizie
• Mendukung kreator dan pengembang dari Indonesia secara legal
• Mengelola pajak pertambahan nilai (VAT / Sales Tax) global secara otomatis
• Payout langsung ditransfer ke rekening bank lokal Indonesia atau Wise / Payoneer

## 2. Struktur Produk di Dashboard Lemon Squeezy
Buat tiga produk subscription di dashboard Lemon Squeezy (lemonsqueezy.com):

1. Apizie Pro Plan
   • Type: Subscription (Monthly)
   • Price: $9 USD / month
   • Custom data parameter: user_id={{user.id}}
   • Description: 25,000 requests per month, cache control, webhooks, 10 API keys

2. Apizie Ultra Plan (Most Popular)
   • Type: Subscription (Monthly)
   • Price: $29 USD / month
   • Custom data parameter: user_id={{user.id}}
   • Description: 200,000 requests per month, always fresh data, bulk jobs, 25 API keys

3. Apizie Max Plan
   • Type: Subscription (Monthly)
   • Price: $99 USD / month
   • Custom data parameter: user_id={{user.id}}
   • Description: 1,000,000 requests per month, priority support, 50 API keys

## 3. Konfigurasi Webhook
URL Webhook di Apizie:
`https://zieapi.vercel.app/api/webhooks/lemonsqueezy`

Event yang dipantau:
• `subscription_created`: Mengubah status user.plan menjadi 'pro' atau 'ultra' serta memperbarui user.planExpiresAt
• `subscription_updated`: Memperbarui kuota bulanan saat periode tagihan baru dimulai
• `subscription_cancelled`: Mengembalikan user.plan ke 'free' saat masa aktif berakhir

Signing Secret:
Disimpan di Vercel Environment Variables sebagai `LEMONSQUEEZY_WEBHOOK_SECRET`
