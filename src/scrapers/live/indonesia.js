// Live Indonesian sources: official / documented public APIs and open datasets only.
//   wilayah        → emsifa/api-wilayah-indonesia (static JSON, open data)
//   quran-kemenag  → equran.id API v2 (teks & terjemahan Kemenag)
//   sholat-kemenag → api.myquran.com v2 (jadwal sholat Kemenag)
//   bmkg           → data.bmkg.go.id + api.bmkg.go.id (wajib atribusi "BMKG")
//   hari-libur     → date.nager.at (Nager.Date public holidays)
//   terbilang      → pure functions, no network

import { url, getJson, f, num, ScraperError } from "../kit.js";

/* ------------------------------------------------------------------ helpers */

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** YYYY-MM-DD for "now" in an IANA time zone (default WIB). */
export function todayIn(tz = "Asia/Jakarta", now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    throw new ScraperError(`Zona waktu tidak dikenal: ${tz}`);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDate(s, field = "date") {
  if (!DATE_RE.test(String(s ?? "")) || Number.isNaN(Date.parse(s + "T00:00:00Z"))) {
    throw new ScraperError(`Parameter ${field} harus berformat YYYY-MM-DD`, { errors: [{ field, message: "format YYYY-MM-DD" }] });
  }
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function paginate(list, page = 1, count = 20) {
  const start = (page - 1) * count;
  return { total: list.length, page, count, totalPages: Math.max(1, Math.ceil(list.length / count)), items: list.slice(start, start + count) };
}

/* ---------------------------------------------------------------- terbilang */

const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

export function terbilang(n) {
  n = Number(n);
  if (!Number.isFinite(n)) throw new ScraperError("Angka tidak valid");
  if (n < 0) return "minus " + terbilang(-n);
  const s = String(n);
  const [intPart, decPart] = s.includes("e") ? [BigInt(Math.trunc(n)).toString(), ""] : s.split(".");
  const words = intWords(BigInt(intPart)) || "nol";
  if (!decPart) return words;
  const dec = [...decPart].map((d) => (d === "0" ? "nol" : SATUAN[Number(d)])).join(" ");
  return `${words} koma ${dec}`;
}

function intWords(n) {
  if (n < 12n) return SATUAN[Number(n)];
  if (n < 20n) return `${intWords(n - 10n)} belas`;
  if (n < 100n) return join(`${intWords(n / 10n)} puluh`, intWords(n % 10n));
  if (n < 200n) return join("seratus", intWords(n - 100n));
  if (n < 1000n) return join(`${intWords(n / 100n)} ratus`, intWords(n % 100n));
  if (n < 2000n) return join("seribu", intWords(n - 1000n));
  const scales = [
    [10n ** 15n, "kuadriliun"],
    [10n ** 12n, "triliun"],
    [10n ** 9n, "miliar"],
    [10n ** 6n, "juta"],
    [10n ** 3n, "ribu"],
  ];
  for (const [v, name] of scales) if (n >= v) return join(`${intWords(n / v)} ${name}`, intWords(n % v));
  return "";
}
const join = (a, b) => (b ? `${a} ${b}` : a);

export function formatRupiah(n, decimals = 0) {
  const neg = n < 0;
  const [i, d] = Math.abs(n).toFixed(decimals).split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}Rp${grouped}${d ? "," + d : ""}`;
}

const capitalizeWords = (s) => s.replace(/(^|\s)([a-z])/g, (_, sp, c) => sp + c.toUpperCase());

/* ------------------------------------------------------------------ wilayah */

const WILAYAH = "https://www.emsifa.com/api-wilayah-indonesia/api";
const codeField = (name, desc, example, pattern) => f.req(name, { description: desc, example, pattern });

const wilayah = {
  category: "indonesia",
  slug: "wilayah",
  displayName: "Wilayah Indonesia",
  description: "Daftar provinsi, kabupaten/kota, kecamatan, dan kelurahan/desa beserta kodenya, dari dataset terbuka emsifa/api-wilayah-indonesia.",
  tags: ["wilayah", "provinsi", "kabupaten", "kecamatan", "desa", "kode-wilayah"],
  indonesian: true,
  endpoints: [
    {
      slug: "provinces",
      displayName: "Provinsi",
      description: "Semua provinsi beserta kodenya.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [],
      handler: async (_p, ctx) => {
        const rows = await getJson(ctx, `${WILAYAH}/provinces.json`);
        const items = (rows ?? []).map((r) => ({ code: r.id, name: r.name }));
        return { count: items.length, items, source: "emsifa/api-wilayah-indonesia" };
      },
    },
    {
      slug: "regencies",
      displayName: "Kabupaten/Kota",
      description: "Kabupaten dan kota dalam satu provinsi.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [codeField("provinceCode", "Kode provinsi (2 digit)", "32", "^\\d{2}$")],
      handler: async ({ provinceCode }, ctx) => {
        const rows = await getJson(ctx, `${WILAYAH}/regencies/${provinceCode}.json`);
        const items = (rows ?? []).map((r) => ({ code: r.id, provinceCode: r.province_id, name: r.name, type: /^KOTA\b/.test(r.name) ? "kota" : "kabupaten" }));
        return { provinceCode, count: items.length, items, source: "emsifa/api-wilayah-indonesia" };
      },
    },
    {
      slug: "districts",
      displayName: "Kecamatan",
      description: "Kecamatan dalam satu kabupaten/kota.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [codeField("regencyCode", "Kode kabupaten/kota (4 digit)", "3273", "^\\d{4}$")],
      handler: async ({ regencyCode }, ctx) => {
        const rows = await getJson(ctx, `${WILAYAH}/districts/${regencyCode}.json`);
        const items = (rows ?? []).map((r) => ({ code: r.id, regencyCode: r.regency_id, name: r.name }));
        return { regencyCode, count: items.length, items, source: "emsifa/api-wilayah-indonesia" };
      },
    },
    {
      slug: "villages",
      displayName: "Kelurahan/Desa",
      description: "Kelurahan dan desa dalam satu kecamatan.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [codeField("districtCode", "Kode kecamatan (7 digit)", "3273010", "^\\d{7}$")],
      handler: async ({ districtCode }, ctx) => {
        const rows = await getJson(ctx, `${WILAYAH}/villages/${districtCode}.json`);
        const items = (rows ?? []).map((r) => ({ code: r.id, districtCode: r.district_id, name: r.name }));
        return { districtCode, count: items.length, items, source: "emsifa/api-wilayah-indonesia" };
      },
    },
    {
      slug: "search",
      displayName: "Cari Wilayah",
      description: "Cari provinsi dan/atau kabupaten/kota berdasarkan nama (pencocokan sebagian, tanpa beda huruf besar-kecil).",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [
        f.req("q", { min: 2, description: "Potongan nama wilayah", example: "bandung" }),
        f.enm("level", ["all", "province", "regency"], { default: "all", description: "Batasi jenis wilayah" }),
      ],
      handler: async ({ q, level = "all" }, ctx) => {
        const needle = String(q).trim().toLowerCase();
        const provinces = (await getJson(ctx, `${WILAYAH}/provinces.json`)) ?? [];
        const results = [];
        if (level !== "regency") {
          for (const p of provinces) if (p.name.toLowerCase().includes(needle)) results.push({ level: "province", code: p.id, name: p.name, parentCode: null });
        }
        if (level !== "province") {
          const lists = await Promise.all(provinces.map((p) => getJson(ctx, `${WILAYAH}/regencies/${p.id}.json`)));
          lists.forEach((rows, i) => {
            for (const r of rows ?? []) {
              if (r.name.toLowerCase().includes(needle)) results.push({ level: "regency", code: r.id, name: r.name, parentCode: r.province_id, parentName: provinces[i].name });
            }
          });
        }
        return { q, level, count: results.length, items: results, source: "emsifa/api-wilayah-indonesia" };
      },
    },
  ],
};

/* ------------------------------------------------------------ quran (equran) */

const EQURAN = "https://equran.id/api/v2";
const surahField = f.int("surah", { required: true, min: 1, max: 114, description: "Nomor surat (1–114)", example: 1 });
const ayahField = f.int("ayah", { required: true, min: 1, max: 286, description: "Nomor ayat", example: 1 });

async function equran(ctx, path) {
  const j = await getJson(ctx, `${EQURAN}${path}`);
  if (!j || (j.code && j.code !== 200) || !j.data) throw new ScraperError(j?.message || "Data equran.id tidak tersedia", { status: j?.code });
  return j.data;
}
const surahMeta = (s) => ({
  number: s.nomor,
  name: s.nama,
  nameLatin: s.namaLatin,
  meaning: s.arti,
  ayahCount: s.jumlahAyat,
  revelation: s.tempatTurun,
  revelationType: /madinah/i.test(s.tempatTurun ?? "") ? "madaniyah" : "makkiyah",
  description: s.deskripsi ?? null,
  audio: s.audioFull ?? null,
});
const ayahOut = (a) => ({ number: a.nomorAyat, arabic: a.teksArab, latin: a.teksLatin, translation: a.teksIndonesia, audio: a.audio ?? null });
function findAyah(data, ayah) {
  const a = (data.ayat ?? []).find((x) => x.nomorAyat === ayah);
  if (!a) throw new ScraperError(`Surat ${data.nomor} hanya memiliki ${data.jumlahAyat} ayat`, { errors: [{ field: "ayah", message: "di luar jangkauan" }] });
  return a;
}
const QSRC = "equran.id";

const quran = {
  category: "indonesia",
  slug: "quran-kemenag",
  displayName: "Al-Qur'an Kemenag",
  description: "Teks Arab, latin, terjemahan, audio, dan tafsir Al-Qur'an versi Kemenag. Data diambil dari API publik equran.id (v2).",
  tags: ["quran", "al-quran", "tafsir", "kemenag", "islam"],
  indonesian: true,
  endpoints: [
    {
      slug: "surah-list",
      displayName: "Daftar Surat",
      description: "Daftar 114 surat dengan filter nama dan tempat turun.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [
        f.str("keyword", { description: "Filter nama latin / arti surat", example: "baqarah" }),
        f.enm("revelation", ["all", "makkiyah", "madaniyah"], { default: "all" }),
        f.int("page", { default: 1, min: 1 }),
        f.int("count", { default: 114, min: 1, max: 114 }),
      ],
      handler: async ({ keyword, revelation = "all", page = 1, count = 114 }, ctx) => {
        let list = (await equran(ctx, "/surat")).map(surahMeta);
        if (keyword) {
          const k = keyword.toLowerCase().replace(/[^a-z0-9]/g, "");
          list = list.filter((s) => `${s.nameLatin} ${s.meaning}`.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/ /g, "").includes(k) || String(s.number) === keyword);
        }
        if (revelation !== "all") list = list.filter((s) => s.revelationType === revelation);
        return { ...paginate(list, page, count), source: QSRC };
      },
    },
    {
      slug: "surah-detail",
      displayName: "Detail Surat",
      description: "Info surat lengkap dengan seluruh ayatnya.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [surahField],
      handler: async ({ surah }, ctx) => {
        const d = await equran(ctx, `/surat/${surah}`);
        return {
          ...surahMeta(d),
          ayahs: (d.ayat ?? []).map(ayahOut),
          next: d.suratSelanjutnya ? { number: d.suratSelanjutnya.nomor, nameLatin: d.suratSelanjutnya.namaLatin } : null,
          previous: d.suratSebelumnya ? { number: d.suratSebelumnya.nomor, nameLatin: d.suratSebelumnya.namaLatin } : null,
          source: QSRC,
        };
      },
    },
    {
      slug: "ayah-list",
      displayName: "Daftar Ayat",
      description: "Ayat-ayat dalam satu surat, dengan paginasi.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [surahField, f.int("page", { default: 1, min: 1 }), f.int("count", { default: 20, min: 1, max: 286 })],
      handler: async ({ surah, page = 1, count = 20 }, ctx) => {
        const d = await equran(ctx, `/surat/${surah}`);
        return { surah: d.nomor, nameLatin: d.namaLatin, ...paginate((d.ayat ?? []).map(ayahOut), page, count), source: QSRC };
      },
    },
    {
      slug: "ayah-detail",
      displayName: "Detail Ayat",
      description: "Satu ayat: teks Arab, latin, terjemahan, dan audio.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [surahField, ayahField],
      handler: async ({ surah, ayah }, ctx) => {
        const d = await equran(ctx, `/surat/${surah}`);
        return { surah: d.nomor, nameLatin: d.namaLatin, ...ayahOut(findAyah(d, ayah)), source: QSRC };
      },
    },
    {
      slug: "tafsir-ayah",
      displayName: "Tafsir Ayat",
      description: "Tafsir Kemenag per ayat. Tanpa parameter ayah, mengembalikan tafsir seluruh surat.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [surahField, f.int("ayah", { min: 1, max: 286, description: "Nomor ayat (opsional)", example: 1 })],
      handler: async ({ surah, ayah }, ctx) => {
        const d = await equran(ctx, `/tafsir/${surah}`);
        let list = (d.tafsir ?? []).map((t) => ({ ayah: t.ayat, text: t.teks }));
        if (ayah) {
          list = list.filter((t) => t.ayah === ayah);
          if (!list.length) throw new ScraperError(`Tafsir surat ${surah} ayat ${ayah} tidak ditemukan`);
        }
        return { surah: d.nomor, nameLatin: d.namaLatin, count: list.length, items: list, source: QSRC };
      },
    },
    {
      slug: "random-ayah",
      displayName: "Ayat Acak",
      description: "Satu ayat acak (opsional dari surat tertentu).",
      method: "GET",
      cacheTtl: 0,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [f.int("surah", { min: 1, max: 114, description: "Batasi ke surat ini (opsional)" })],
      handler: async ({ surah }, ctx) => {
        const n = surah ?? 1 + Math.floor(Math.random() * 114);
        const d = await equran(ctx, `/surat/${n}`);
        const ayat = d.ayat ?? [];
        if (!ayat.length) throw new ScraperError("Ayat tidak tersedia");
        const a = ayat[Math.floor(Math.random() * ayat.length)];
        return { surah: d.nomor, nameLatin: d.namaLatin, ...ayahOut(a), source: QSRC };
      },
    },
  ],
};

/* ------------------------------------------------------ sholat (myquran v2) */

const MYQURAN = "https://api.myquran.com/v2";
const MSRC = "api.myquran.com (Kemenag)";

async function myquran(ctx, path) {
  const j = await getJson(ctx, `${MYQURAN}${path}`);
  if (!j || j.status === false || j.data === undefined) throw new ScraperError(j?.message || "Data tidak ditemukan di myquran", { status: 404 });
  return j.data;
}
const cityOut = (c) => ({ id: c.id, name: c.lokasi });
async function resolveCity(ctx, { cityId, city }) {
  if (cityId) return String(cityId);
  if (!city) throw new ScraperError("Isi cityId atau city", { errors: [{ field: "cityId", message: "cityId atau city wajib diisi" }] });
  const list = await myquran(ctx, `/sholat/kota/cari/${encodeURIComponent(city)}`);
  if (!Array.isArray(list) || !list.length) throw new ScraperError(`Kota "${city}" tidak ditemukan`, { status: 404 });
  const exact = list.find((c) => c.lokasi.toLowerCase().replace(/^(kab\.|kota)\s*/, "") === city.toLowerCase());
  return String((exact ?? list[0]).id);
}
const jadwalOut = (j) => ({
  date: j.date,
  tanggal: j.tanggal,
  imsak: j.imsak,
  subuh: j.subuh,
  terbit: j.terbit,
  dhuha: j.dhuha,
  dzuhur: j.dzuhur,
  ashar: j.ashar,
  maghrib: j.maghrib,
  isya: j.isya,
});
const cityFields = [f.str("cityId", { description: "ID kota myquran (lihat city-search)", example: "1301" }), f.str("city", { description: "Nama kota (dipakai bila cityId kosong)", example: "jakarta" })];

async function jadwalDay(ctx, p, date) {
  const { y, m, d } = parseDate(date);
  const id = await resolveCity(ctx, p);
  const data = await myquran(ctx, `/sholat/jadwal/${id}/${y}/${pad(m)}/${pad(d)}`);
  return { cityId: String(data.id ?? id), city: data.lokasi, region: data.daerah, jadwal: jadwalOut(data.jadwal ?? {}), source: MSRC };
}
async function jadwalMonth(ctx, id, y, m) {
  const data = await myquran(ctx, `/sholat/jadwal/${id}/${y}/${pad(m)}`);
  return { data, list: (Array.isArray(data.jadwal) ? data.jadwal : []).map(jadwalOut) };
}

const KAABA = { lat: 21.422487, lng: 39.826206 };
export function qiblaBearing(lat, lng) {
  const r = Math.PI / 180;
  const dl = (KAABA.lng - lng) * r;
  const p1 = lat * r;
  const p2 = KAABA.lat * r;
  const deg = Math.atan2(Math.sin(dl), Math.cos(p1) * Math.tan(p2) - Math.sin(p1) * Math.cos(dl)) / r;
  return (deg + 360) % 360;
}
function haversineKm(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

const sholat = {
  category: "indonesia",
  slug: "sholat-kemenag",
  displayName: "Jadwal Sholat Kemenag",
  description: "Jadwal sholat harian dan bulanan untuk kabupaten/kota di Indonesia (perhitungan Kemenag) melalui API publik myquran.com v2, plus arah kiblat.",
  tags: ["sholat", "jadwal-sholat", "imsakiyah", "kiblat", "kemenag", "islam"],
  indonesian: true,
  endpoints: [
    {
      slug: "city-list",
      displayName: "Daftar Kota",
      description: "Semua kabupaten/kota yang didukung, dengan filter kata kunci dan paginasi.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [f.str("keyword", { description: "Filter nama kota" }), f.int("page", { default: 1, min: 1 }), f.int("count", { default: 50, min: 1, max: 600 })],
      handler: async ({ keyword, page = 1, count = 50 }, ctx) => {
        let list = (await myquran(ctx, "/sholat/kota/semua")).map(cityOut);
        if (keyword) list = list.filter((c) => c.name.toLowerCase().includes(keyword.toLowerCase()));
        return { ...paginate(list, page, count), source: MSRC };
      },
    },
    {
      slug: "city-detail",
      displayName: "Detail Kota",
      description: "Nama lokasi untuk satu ID kota.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [f.req("cityId", { example: "1301" })],
      handler: async ({ cityId }, ctx) => {
        const d = await myquran(ctx, `/sholat/kota/id/${encodeURIComponent(cityId)}`);
        const c = Array.isArray(d) ? d[0] : d;
        if (!c) throw new ScraperError(`Kota ${cityId} tidak ditemukan`, { status: 404 });
        return { ...cityOut(c), source: MSRC };
      },
    },
    {
      slug: "city-search",
      displayName: "Cari Kota",
      description: "Cari ID kota berdasarkan nama.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [f.req("q", { min: 3, example: "bandung" })],
      handler: async ({ q }, ctx) => {
        const list = await myquran(ctx, `/sholat/kota/cari/${encodeURIComponent(q)}`).catch((e) => {
          if (e instanceof ScraperError && (e.upstreamStatus === 404 || /tidak ditemukan/i.test(e.message))) return [];
          throw e;
        });
        const items = (Array.isArray(list) ? list : []).map(cityOut);
        return { q, count: items.length, items, source: MSRC };
      },
    },
    {
      slug: "jadwal-today",
      displayName: "Jadwal Hari Ini",
      description: "Jadwal sholat hari ini (tanggal mengikuti zona waktu tz).",
      method: "GET",
      cacheTtl: 1800,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [...cityFields, f.str("tz", { default: "Asia/Jakarta", description: "Zona waktu penentu tanggal 'hari ini'", example: "Asia/Makassar" })],
      handler: async (p, ctx) => jadwalDay(ctx, p, todayIn(p.tz || "Asia/Jakarta")),
    },
    {
      slug: "jadwal-daily",
      displayName: "Jadwal per Tanggal",
      description: "Jadwal sholat untuk satu tanggal.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [...cityFields, f.req("date", { pattern: "^\\d{4}-\\d{2}-\\d{2}$", example: "2026-03-20" })],
      handler: async (p, ctx) => jadwalDay(ctx, p, p.date),
    },
    {
      slug: "jadwal-monthly",
      displayName: "Jadwal Bulanan",
      description: "Jadwal sholat satu bulan penuh.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [...cityFields, f.int("year", { required: true, min: 2000, max: 2100, example: 2026 }), f.int("month", { required: true, min: 1, max: 12, example: 3 })],
      handler: async (p, ctx) => {
        const id = await resolveCity(ctx, p);
        const { data, list } = await jadwalMonth(ctx, id, p.year, p.month);
        return { cityId: String(data.id ?? id), city: data.lokasi, region: data.daerah, year: p.year, month: p.month, count: list.length, items: list, source: MSRC };
      },
    },
    {
      slug: "jadwal-range",
      displayName: "Jadwal Rentang Tanggal",
      description: "Jadwal sholat dari tanggal from sampai to (maks 92 hari).",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [...cityFields, f.req("from", { pattern: "^\\d{4}-\\d{2}-\\d{2}$", example: "2026-03-01" }), f.req("to", { pattern: "^\\d{4}-\\d{2}-\\d{2}$", example: "2026-03-31" })],
      handler: async (p, ctx) => {
        const a = parseDate(p.from, "from");
        const b = parseDate(p.to, "to");
        if (p.to < p.from) throw new ScraperError("to harus setelah from");
        if ((Date.parse(p.to) - Date.parse(p.from)) / 86400000 > 92) throw new ScraperError("Rentang maksimal 92 hari");
        const id = await resolveCity(ctx, p);
        const months = [];
        for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 12 ? ((m = 1), y++) : m++) months.push([y, m]);
        const res = await Promise.all(months.map(([y, m]) => jadwalMonth(ctx, id, y, m)));
        const items = res.flatMap((r) => r.list).filter((j) => j.date >= p.from && j.date <= p.to);
        const first = res[0]?.data ?? {};
        return { cityId: String(first.id ?? id), city: first.lokasi, region: first.daerah, from: p.from, to: p.to, count: items.length, items, source: MSRC };
      },
    },
    {
      slug: "qibla",
      displayName: "Arah Kiblat",
      description: "Arah kiblat (derajat dari utara sejati, searah jarum jam) dan jarak ke Ka'bah dari sebuah koordinat. Dihitung lokal.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [f.num("lat", { required: true, min: -90, max: 90, example: -6.2 }), f.num("lng", { required: true, min: -180, max: 180, example: 106.8166 })],
      handler: ({ lat, lng }) => {
        const bearing = qiblaBearing(lat, lng);
        const dirs = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];
        return {
          lat,
          lng,
          bearing: Math.round(bearing * 100) / 100,
          compass: dirs[Math.round(bearing / 45) % 8],
          distanceKm: Math.round(haversineKm({ lat, lng }, KAABA) * 10) / 10,
          kaaba: KAABA,
        };
      },
    },
  ],
};

/* --------------------------------------------------------------------- BMKG */

const BMKG_TEWS = "https://data.bmkg.go.id/DataMKG/TEWS";
const BMKG_SRC = "BMKG";
const BMKG_ATTR = "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)";

function gempaOut(g) {
  const [lat, lng] = String(g.Coordinates ?? "").split(",").map(num);
  return {
    tanggal: g.Tanggal ?? null,
    jam: g.Jam ?? null,
    datetime: g.DateTime ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    lintang: g.Lintang ?? null,
    bujur: g.Bujur ?? null,
    magnitude: num(g.Magnitude),
    kedalaman: g.Kedalaman ?? null,
    kedalamanKm: num(String(g.Kedalaman ?? "").replace(/[^\d.]/g, "")),
    wilayah: g.Wilayah ?? null,
    potensi: g.Potensi ?? null,
    dirasakan: g.Dirasakan ?? null,
    shakemap: g.Shakemap ? `${BMKG_TEWS}/${g.Shakemap}` : null,
  };
}
async function gempaList(ctx, file) {
  const j = await getJson(ctx, `${BMKG_TEWS}/${file}`);
  const g = j?.Infogempa?.gempa;
  if (!g) throw new ScraperError("Format data BMKG tidak dikenal");
  return Array.isArray(g) ? g : [g];
}

function flattenCuaca(rows) {
  const out = [];
  for (const block of rows ?? []) for (const day of Array.isArray(block) ? block : [block]) if (day) out.push(day);
  return out.map((c) => ({
    localDatetime: c.local_datetime ?? null,
    utcDatetime: c.utc_datetime ?? null,
    suhu: num(c.t),
    kelembapan: num(c.hu),
    tutupanAwan: num(c.tcc),
    curahHujan: num(c.tp),
    cuaca: c.weather_desc ?? null,
    cuacaEn: c.weather_desc_en ?? null,
    kodeCuaca: num(c.weather),
    arahAnginDari: c.wd ?? null,
    arahAnginKe: c.wd_to ?? null,
    arahAnginDeg: num(c.wd_deg),
    kecepatanAngin: num(c.ws),
    jarakPandang: c.vs_text ?? null,
    icon: c.image ?? null,
  }));
}

const bmkg = {
  category: "indonesia",
  slug: "bmkg",
  displayName: "BMKG",
  description: "Info gempa bumi terkini dan prakiraan cuaca per kelurahan/desa dari data terbuka BMKG. Wajib mencantumkan BMKG sebagai sumber.",
  tags: ["bmkg", "gempa", "cuaca", "prakiraan-cuaca", "bencana"],
  indonesian: true,
  endpoints: [
    {
      slug: "gempa-terkini",
      displayName: "Gempa Terkini",
      description: "Gempa bumi terakhir (M ≥ 5 atau yang dirasakan) beserta peta guncangan.",
      method: "GET",
      cacheTtl: 60,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [],
      handler: async (_p, ctx) => {
        const [g] = await gempaList(ctx, "autogempa.json");
        return { gempa: gempaOut(g), source: BMKG_SRC, attribution: BMKG_ATTR };
      },
    },
    {
      slug: "gempa-terbaru",
      displayName: "15 Gempa M5+",
      description: "Daftar 15 gempa bumi terbaru dengan magnitudo 5,0 ke atas.",
      method: "GET",
      cacheTtl: 120,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [],
      handler: async (_p, ctx) => {
        const items = (await gempaList(ctx, "gempaterkini.json")).map(gempaOut);
        return { count: items.length, items, source: BMKG_SRC, attribution: BMKG_ATTR };
      },
    },
    {
      slug: "gempa-dirasakan",
      displayName: "Gempa Dirasakan",
      description: "Daftar 15 gempa bumi terbaru yang guncangannya dirasakan warga.",
      method: "GET",
      cacheTtl: 120,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [],
      handler: async (_p, ctx) => {
        const items = (await gempaList(ctx, "gempadirasakan.json")).map(gempaOut);
        return { count: items.length, items, source: BMKG_SRC, attribution: BMKG_ATTR };
      },
    },
    {
      slug: "cuaca",
      displayName: "Prakiraan Cuaca",
      description: "Prakiraan cuaca 3 harian (interval 3 jam) untuk satu kelurahan/desa berdasarkan kode wilayah adm4 Kemendagri.",
      method: "GET",
      cacheTtl: 1800,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [f.req("adm4", { pattern: "^\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d{4}$", description: "Kode wilayah tingkat IV (kelurahan/desa), format 31.71.03.1001", example: "31.71.03.1001" })],
      handler: async ({ adm4 }, ctx) => {
        const j = await getJson(ctx, url("https://api.bmkg.go.id/publik/prakiraan-cuaca", { adm4 }));
        const block = j?.data?.[0];
        if (!block) throw new ScraperError(`Prakiraan cuaca untuk ${adm4} tidak tersedia`, { status: 404 });
        const l = j.lokasi ?? block.lokasi ?? {};
        return {
          lokasi: {
            adm4: l.adm4 ?? adm4,
            provinsi: l.provinsi ?? null,
            kotkab: l.kotkab ?? null,
            kecamatan: l.kecamatan ?? null,
            desa: l.desa ?? null,
            lat: num(l.lat),
            lng: num(l.lon),
            timezone: l.timezone ?? null,
          },
          forecast: flattenCuaca(block.cuaca),
          source: BMKG_SRC,
          attribution: BMKG_ATTR,
        };
      },
    },
  ],
};

/* --------------------------------------------------------------- hari libur */

const NAGER = "https://date.nager.at/api/v3/PublicHolidays";
const holidayOut = (h) => ({ date: h.date, name: h.localName, nameEn: h.name, fixed: h.fixed ?? null, types: h.types ?? [] });
const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const hariLibur = {
  category: "indonesia",
  slug: "hari-libur",
  displayName: "Hari Libur Nasional",
  description: "Hari libur nasional Indonesia per tahun dan cek apakah suatu tanggal libur, dari Nager.Date. Cuti bersama belum tentu tercakup.",
  tags: ["hari-libur", "libur-nasional", "kalender", "tanggal-merah"],
  indonesian: true,
  endpoints: [
    {
      slug: "list",
      displayName: "Daftar Hari Libur",
      description: "Semua hari libur nasional dalam satu tahun.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [f.int("year", { min: 1975, max: 2100, description: "Tahun (default: tahun ini)", example: 2026 })],
      handler: async ({ year }, ctx) => {
        const y = year ?? Number(todayIn().slice(0, 4));
        const rows = await getJson(ctx, `${NAGER}/${y}/ID`);
        const items = (rows ?? []).map(holidayOut);
        return { year: y, count: items.length, items, source: "date.nager.at" };
      },
    },
    {
      slug: "cek",
      displayName: "Cek Tanggal",
      description: "Apakah tanggal tertentu hari libur nasional atau akhir pekan.",
      method: "GET",
      cacheTtl: 3600,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [f.str("date", { pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Tanggal YYYY-MM-DD (default: hari ini WIB)", example: "2026-08-17" })],
      handler: async ({ date }, ctx) => {
        const d = date || todayIn();
        const { y } = parseDate(d);
        const rows = await getJson(ctx, `${NAGER}/${y}/ID`);
        const holidays = (rows ?? []).filter((h) => h.date === d).map(holidayOut);
        const dow = new Date(d + "T00:00:00Z").getUTCDay();
        return {
          date: d,
          day: WEEKDAYS[dow],
          isHoliday: holidays.length > 0,
          isWeekend: dow === 0 || dow === 6,
          isDayOff: holidays.length > 0 || dow === 0 || dow === 6,
          holidays,
          source: "date.nager.at",
        };
      },
    },
  ],
};

/* -------------------------------------------------------------- terbilang */

const terbilangScraper = {
  category: "indonesia",
  slug: "terbilang",
  displayName: "Terbilang",
  description: "Ubah angka menjadi kalimat terbilang Bahasa Indonesia (untuk kuitansi, invoice) dan format nominal rupiah. Tanpa sumber eksternal.",
  tags: ["terbilang", "angka", "rupiah", "kuitansi"],
  indonesian: true,
  endpoints: [
    {
      slug: "convert",
      displayName: "Angka ke Terbilang",
      description: "Angka → kata, opsional dengan akhiran 'rupiah' dan huruf kapital.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [
        f.num("number", { required: true, min: -9.99e17, max: 9.99e17, description: "Angka (maks 999 kuadriliun)", example: 1250000 }),
        f.bool("currency", { default: false, description: "Tambahkan kata 'rupiah'" }),
        f.bool("capitalize", { default: false, description: "Huruf kapital di awal setiap kata" }),
      ],
      exampleResponse: { number: 1250000, text: "satu juta dua ratus lima puluh ribu", formatted: "Rp1.250.000" },
      handler: ({ number, currency, capitalize }) => {
        let text = terbilang(number) + (currency ? " rupiah" : "");
        if (capitalize) text = capitalizeWords(text);
        return { number, text, formatted: formatRupiah(number) };
      },
    },
    {
      slug: "format-rupiah",
      displayName: "Format Rupiah",
      description: "Format nominal dengan pemisah ribuan titik dan desimal koma.",
      method: "GET",
      cacheTtl: 86400,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [
        f.num("number", { required: true, example: 1250000.5, description: "Nominal" }),
        f.int("decimals", { default: 0, min: 0, max: 2, description: "Jumlah desimal" }),
      ],
      exampleResponse: { number: 1250000.5, formatted: "Rp1.250.000" },
      handler: ({ number, decimals = 0 }) => ({ number, formatted: formatRupiah(number, decimals) }),
    },
  ],
};

export default [wilayah, quran, sholat, bmkg, hariLibur, terbilangScraper];
