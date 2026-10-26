import { test } from "node:test";
import assert from "node:assert/strict";
import defs, { terbilang, formatRupiah, qiblaBearing } from "../../src/scrapers/live/indonesia.js";
import { checkModule, mockFetch, run } from "./harness.js";

test("module shape", () => checkModule(defs));

test("terbilang cases", () => {
  const cases = [
    [0, "nol"],
    [11, "sebelas"],
    [115, "seratus lima belas"],
    [1001, "seribu satu"],
    [1250000, "satu juta dua ratus lima puluh ribu"],
    [-7, "minus tujuh"],
    [2.5, "dua koma lima"],
    [10, "sepuluh"],
    [19, "sembilan belas"],
    [2000, "dua ribu"],
    [1e12, "satu triliun"],
  ];
  for (const [n, w] of cases) assert.equal(terbilang(n), w, String(n));
  assert.equal(formatRupiah(1250000), "Rp1.250.000");
  assert.equal(formatRupiah(-1234.5, 2), "-Rp1.234,50");
});

test("terbilang endpoints", async () => {
  const r = await run(defs, "indonesia:terbilang", "convert", { number: 1250000, currency: true, capitalize: true }, mockFetch([]));
  assert.equal(r.text, "Satu Juta Dua Ratus Lima Puluh Ribu Rupiah");
  assert.equal(r.formatted, "Rp1.250.000");
  const fr = await run(defs, "indonesia:terbilang", "format-rupiah", { number: 1250000.5, decimals: 2 }, mockFetch([]));
  assert.equal(fr.formatted, "Rp1.250.000,50");
});

test("wilayah", async () => {
  const fetch = mockFetch([
    ["/provinces.json", [{ id: "32", name: "JAWA BARAT" }, { id: "31", name: "DKI JAKARTA" }]],
    ["/regencies/32.json", [{ id: "3273", province_id: "32", name: "KOTA BANDUNG" }, { id: "3204", province_id: "32", name: "KABUPATEN BANDUNG" }]],
    ["/regencies/31.json", [{ id: "3171", province_id: "31", name: "KOTA JAKARTA SELATAN" }]],
    ["/districts/3273.json", [{ id: "3273010", regency_id: "3273", name: "SUKASARI" }]],
    ["/villages/3273010.json", [{ id: "3273010001", district_id: "3273010", name: "GEGERKALONG" }]],
  ]);
  const p = await run(defs, "indonesia:wilayah", "provinces", {}, fetch);
  assert.equal(p.count, 2);
  assert.equal(fetch.calls[0].url, "https://www.emsifa.com/api-wilayah-indonesia/api/provinces.json");
  const r = await run(defs, "indonesia:wilayah", "regencies", { provinceCode: "32" }, fetch);
  assert.deepEqual(r.items[0], { code: "3273", provinceCode: "32", name: "KOTA BANDUNG", type: "kota" });
  assert.equal((await run(defs, "indonesia:wilayah", "districts", { regencyCode: "3273" }, fetch)).items[0].name, "SUKASARI");
  assert.equal((await run(defs, "indonesia:wilayah", "villages", { districtCode: "3273010" }, fetch)).items[0].code, "3273010001");
  const s = await run(defs, "indonesia:wilayah", "search", { q: "bandung" }, fetch);
  assert.equal(s.count, 2);
  assert.ok(s.items.every((x) => x.level === "regency" && x.parentName === "JAWA BARAT"));
  const s2 = await run(defs, "indonesia:wilayah", "search", { q: "jawa", level: "province" }, fetch);
  assert.deepEqual(s2.items.map((x) => x.code), ["32"]);
});

const SURAT = {
  nomor: 1,
  nama: "الفاتحة",
  namaLatin: "Al-Fatihah",
  jumlahAyat: 2,
  tempatTurun: "Mekah",
  arti: "Pembukaan",
  deskripsi: "…",
  audioFull: {},
  ayat: [
    { nomorAyat: 1, teksArab: "بِسْمِ", teksLatin: "bismillāh", teksIndonesia: "Dengan nama Allah", audio: {} },
    { nomorAyat: 2, teksArab: "اَلْحَمْدُ", teksLatin: "al-ḥamdu", teksIndonesia: "Segala puji", audio: {} },
  ],
  suratSelanjutnya: { nomor: 2, namaLatin: "Al-Baqarah" },
  suratSebelumnya: false,
};

test("quran-kemenag (equran.id)", async () => {
  const fetch = mockFetch([
    [/\/api\/v2\/surat$/, { code: 200, data: [SURAT, { ...SURAT, nomor: 2, namaLatin: "Al-Baqarah", tempatTurun: "Madinah", arti: "Sapi Betina" }] }],
    ["/api/v2/surat/1", { code: 200, data: SURAT }],
    ["/api/v2/tafsir/1", { code: 200, data: { nomor: 1, namaLatin: "Al-Fatihah", tafsir: [{ ayat: 1, teks: "Tafsir 1" }, { ayat: 2, teks: "Tafsir 2" }] } }],
  ]);
  const l = await run(defs, "indonesia:quran-kemenag", "surah-list", { revelation: "madaniyah" }, fetch);
  assert.deepEqual(l.items.map((s) => s.number), [2]);
  assert.equal(fetch.calls[0].url, "https://equran.id/api/v2/surat");
  assert.equal((await run(defs, "indonesia:quran-kemenag", "surah-list", { keyword: "fatihah" }, fetch)).total, 1);
  const d = await run(defs, "indonesia:quran-kemenag", "surah-detail", { surah: 1 }, fetch);
  assert.equal(d.ayahs.length, 2);
  assert.equal(d.next.number, 2);
  const a = await run(defs, "indonesia:quran-kemenag", "ayah-detail", { surah: 1, ayah: 2 }, fetch);
  assert.equal(a.translation, "Segala puji");
  await assert.rejects(run(defs, "indonesia:quran-kemenag", "ayah-detail", { surah: 1, ayah: 9 }, fetch), /hanya memiliki/);
  assert.equal((await run(defs, "indonesia:quran-kemenag", "ayah-list", { surah: 1, count: 1, page: 2 }, fetch)).items[0].number, 2);
  const t = await run(defs, "indonesia:quran-kemenag", "tafsir-ayah", { surah: 1, ayah: 2 }, fetch);
  assert.deepEqual(t.items, [{ ayah: 2, text: "Tafsir 2" }]);
  const r = await run(defs, "indonesia:quran-kemenag", "random-ayah", { surah: 1 }, fetch);
  assert.ok([1, 2].includes(r.number));
});

test("sholat-kemenag (myquran v2)", async () => {
  const jadwal = (date) => ({ tanggal: "x", imsak: "04:30", subuh: "04:40", terbit: "05:55", dhuha: "06:20", dzuhur: "11:55", ashar: "15:10", maghrib: "18:00", isya: "19:10", date });
  const fetch = mockFetch([
    ["/sholat/kota/semua", { status: true, data: [{ id: "1301", lokasi: "KOTA JAKARTA" }, { id: "1219", lokasi: "KOTA BANDUNG" }] }],
    ["/sholat/kota/cari/zzz", { status: false, message: "Data tidak ditemukan" }],
    ["/sholat/kota/cari/", { status: true, data: [{ id: "1219", lokasi: "KOTA BANDUNG" }] }],
    ["/sholat/kota/id/1301", { status: true, data: { id: "1301", lokasi: "KOTA JAKARTA" } }],
    [/\/sholat\/jadwal\/\d+\/\d{4}\/\d{2}\/\d{2}$/, (u) => {
      const [, , y, m, d] = u.match(/jadwal\/(\d+)\/(\d{4})\/(\d{2})\/(\d{2})/);
      return Response.json({ status: true, data: { id: 1219, lokasi: "KOTA BANDUNG", daerah: "JAWA BARAT", jadwal: jadwal(`${y}-${m}-${d}`) } });
    }],
    [/\/sholat\/jadwal\/\d+\/\d{4}\/\d{2}$/, (u) => {
      const [, , y, m] = u.match(/jadwal\/(\d+)\/(\d{4})\/(\d{2})$/);
      return Response.json({ status: true, data: { id: 1219, lokasi: "KOTA BANDUNG", daerah: "JAWA BARAT", jadwal: [1, 15, 28].map((d) => jadwal(`${y}-${m}-${String(d).padStart(2, "0")}`)) } });
    }],
  ]);
  const L = "indonesia:sholat-kemenag";
  assert.equal((await run(defs, L, "city-list", { keyword: "band" }, fetch)).items[0].id, "1219");
  assert.equal((await run(defs, L, "city-detail", { cityId: "1301" }, fetch)).name, "KOTA JAKARTA");
  assert.equal((await run(defs, L, "city-search", { q: "bandung" }, fetch)).count, 1);
  assert.equal((await run(defs, L, "city-search", { q: "zzz" }, fetch)).count, 0);
  const d = await run(defs, L, "jadwal-daily", { city: "bandung", date: "2026-03-20" }, fetch);
  assert.equal(d.cityId, "1219");
  assert.equal(d.jadwal.maghrib, "18:00");
  assert.ok(fetch.calls.some((c) => c.url === "https://api.myquran.com/v2/sholat/jadwal/1219/2026/03/20"));
  const t = await run(defs, L, "jadwal-today", { cityId: "1219" }, fetch);
  assert.match(t.jadwal.date, /^\d{4}-\d{2}-\d{2}$/);
  const m = await run(defs, L, "jadwal-monthly", { cityId: "1219", year: 2026, month: 3 }, fetch);
  assert.equal(m.count, 3);
  const r = await run(defs, L, "jadwal-range", { cityId: "1219", from: "2026-03-10", to: "2026-04-20" }, fetch);
  assert.deepEqual(r.items.map((x) => x.date), ["2026-03-15", "2026-03-28", "2026-04-01", "2026-04-15"]);
  await assert.rejects(run(defs, L, "jadwal-daily", { date: "2026-03-20" }, fetch), /cityId atau city/);
  const q = await run(defs, L, "qibla", { lat: -6.2, lng: 106.8166 }, fetch);
  assert.ok(q.bearing > 294 && q.bearing < 296, String(q.bearing));
  assert.ok(Math.abs(qiblaBearing(-6.2, 106.8166) - q.bearing) < 0.01);
});

test("bmkg", async () => {
  const g = { Tanggal: "26 Okt 2026", Jam: "10:00:00 WIB", DateTime: "2026-10-26T03:00:00+00:00", Coordinates: "-7.50,110.20", Lintang: "7.50 LS", Bujur: "110.20 BT", Magnitude: "5.1", Kedalaman: "10 km", Wilayah: "Pusat gempa di darat", Potensi: "Tidak berpotensi tsunami", Dirasakan: "III Yogyakarta", Shakemap: "20261026100000.mmi.jpg" };
  const fetch = mockFetch([
    ["/TEWS/autogempa.json", { Infogempa: { gempa: g } }],
    ["/TEWS/gempaterkini.json", { Infogempa: { gempa: [g, g] } }],
    ["/TEWS/gempadirasakan.json", { Infogempa: { gempa: [g] } }],
    ["api.bmkg.go.id/publik/prakiraan-cuaca", {
      lokasi: { adm4: "31.71.03.1001", provinsi: "DKI Jakarta", kotkab: "Kota Adm. Jakarta Pusat", kecamatan: "Kemayoran", desa: "Gunung Sahari Selatan", lon: 106.84, lat: -6.16, timezone: "Asia/Jakarta" },
      data: [{ lokasi: {}, cuaca: [[{ local_datetime: "2026-10-26 10:00:00", t: 31, hu: 70, tcc: 50, tp: 0, weather: 3, weather_desc: "Berawan", weather_desc_en: "Mostly Cloudy", wd: "W", wd_to: "E", wd_deg: 270, ws: 8, vs_text: "> 10 km", image: "x.svg" }], [{ local_datetime: "2026-10-27 10:00:00", t: 30 }]] }],
    }],
  ]);
  const t = await run(defs, "indonesia:bmkg", "gempa-terkini", {}, fetch);
  assert.equal(t.source, "BMKG");
  assert.equal(t.gempa.magnitude, 5.1);
  assert.equal(t.gempa.lat, -7.5);
  assert.equal(t.gempa.kedalamanKm, 10);
  assert.equal(t.gempa.shakemap, "https://data.bmkg.go.id/DataMKG/TEWS/20261026100000.mmi.jpg");
  assert.equal(fetch.calls[0].url, "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json");
  const b = await run(defs, "indonesia:bmkg", "gempa-terbaru", {}, fetch);
  assert.equal(b.count, 2);
  assert.equal(b.source, "BMKG");
  assert.equal((await run(defs, "indonesia:bmkg", "gempa-dirasakan", {}, fetch)).items[0].dirasakan, "III Yogyakarta");
  const c = await run(defs, "indonesia:bmkg", "cuaca", { adm4: "31.71.03.1001" }, fetch);
  assert.equal(fetch.calls.at(-1).url, "https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=31.71.03.1001");
  assert.equal(c.source, "BMKG");
  assert.equal(c.lokasi.desa, "Gunung Sahari Selatan");
  assert.equal(c.forecast.length, 2);
  assert.equal(c.forecast[0].cuaca, "Berawan");
});

test("hari-libur (Nager.Date)", async () => {
  const fetch = mockFetch([
    ["/PublicHolidays/2026/ID", [
      { date: "2026-01-01", localName: "Tahun Baru Masehi", name: "New Year's Day", countryCode: "ID", fixed: true, types: ["Public"] },
      { date: "2026-08-17", localName: "Hari Kemerdekaan", name: "Independence Day", countryCode: "ID", fixed: true, types: ["Public"] },
    ]],
  ]);
  const l = await run(defs, "indonesia:hari-libur", "list", { year: 2026 }, fetch);
  assert.equal(fetch.calls[0].url, "https://date.nager.at/api/v3/PublicHolidays/2026/ID");
  assert.equal(l.count, 2);
  const c = await run(defs, "indonesia:hari-libur", "cek", { date: "2026-08-17" }, fetch);
  assert.equal(c.isHoliday, true);
  assert.equal(c.day, "Senin");
  assert.equal(c.holidays[0].name, "Hari Kemerdekaan");
  const n = await run(defs, "indonesia:hari-libur", "cek", { date: "2026-08-15" }, fetch);
  assert.equal(n.isHoliday, false);
  assert.equal(n.isWeekend, true);
});
