// Indonesian utilities that need no upstream site.

const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

export function terbilang(n) {
  if (!Number.isFinite(n)) throw new Error("not a number");
  if (n < 0) return "minus " + terbilang(-n);
  const [intPart, decPart] = String(n).includes("e") ? [String(Math.trunc(n)), ""] : String(n).split(".");
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

export default [
  {
    category: "indonesia",
    slug: "terbilang",
    displayName: "Terbilang",
    description: "Ubah angka menjadi kalimat terbilang Bahasa Indonesia (untuk kuitansi, invoice).",
    tags: ["terbilang", "angka", "rupiah", "kuitansi", "indonesia"],
    indonesian: true,
    endpoints: [
      {
        slug: "convert",
        displayName: "Angka ke Terbilang",
        method: "GET",
        cacheTtl: 86400,
        bulkEnabled: true,
        fields: [
          { name: "number", type: "number", required: true, description: "Angka (maks 999 kuadriliun)", example: 1250000, min: -9.99e17, max: 9.99e17 },
          { name: "currency", type: "boolean", required: false, default: false, description: "Tambahkan kata 'rupiah'" },
          { name: "capitalize", type: "boolean", required: false, default: false, description: "Huruf kapital di awal setiap kata" },
        ],
        exampleResponse: { number: 1250000, text: "satu juta dua ratus lima puluh ribu", formatted: "Rp1.250.000" },
        handler: ({ number, currency, capitalize }) => {
          let text = terbilang(number) + (currency ? " rupiah" : "");
          if (capitalize) text = text.replace(/\b\w/g, (c) => c.toUpperCase());
          return { number, text, formatted: formatRupiah(number) };
        },
      },
      {
        slug: "format-rupiah",
        displayName: "Format Rupiah",
        method: "GET",
        cacheTtl: 86400,
        fields: [
          { name: "number", type: "number", required: true, example: 1250000.5, description: "Nominal" },
          { name: "decimals", type: "integer", required: false, default: 0, min: 0, max: 2, description: "Jumlah desimal" },
        ],
        exampleResponse: { formatted: "Rp1.250.000" },
        handler: ({ number, decimals }) => ({ number, formatted: formatRupiah(number, decimals) }),
      },
    ],
  },
];
