// Example builds shown on /showcase. These are reference projects written by the Apizie team, not customer
// testimonials: every snippet calls real catalog endpoints and is labelled as an example on the page.
// `uses` entries are catalog keys + endpoint slugs; test/app.test.js checks that each one exists.

export const SHOWCASE_EXAMPLES = [
  {
    slug: "earthquake-alert-bot",
    kind: "Telegram bot",
    title: "Earthquake alert bot",
    summary: "Checks BMKG every minute and posts any new earthquake of magnitude 5 or more to a Telegram channel, with location, depth and the tsunami note.",
    who: "Newsrooms, community groups, local government",
    uses: [["indonesia:bmkg", "gempa-terkini"]],
    lang: "Node.js",
    code: `const API = "https://apizie.vercel.app/v1";
const headers = { "x-api-key": process.env.APIZIE_KEY };
let lastSeen = null;

setInterval(async () => {
  const res = await fetch(\`\${API}/indonesia:bmkg/gempa-terkini\`, { headers });
  const { data } = await res.json();
  const quake = data.gempa; // magnitude, wilayah, kedalaman, potensi, datetime, shakemap
  if (!quake || quake.datetime === lastSeen || quake.magnitude < 5) return;
  lastSeen = quake.datetime;
  await sendTelegram(\`M\${quake.magnitude} · \${quake.wilayah}\\nDepth \${quake.kedalaman} · \${quake.potensi}\`);
}, 60_000);`,
  },
  {
    slug: "crypto-rupiah-board",
    kind: "Web widget",
    title: "Crypto prices in rupiah",
    summary: "A price board for Bitcoin, Ethereum and Solana in IDR with 24-hour change, refreshed every 30 seconds. One request covers every coin.",
    who: "Finance blogs, trading communities, portfolio apps",
    uses: [["finance:coingecko", "simple-price"], ["finance:binance", "ticker"]],
    lang: "JavaScript",
    code: `const url = "https://apizie.vercel.app/v1/finance:coingecko/simple-price"
  + "?ids=bitcoin,ethereum,solana&vsCurrencies=idr&include24hChange=true";

async function refresh() {
  const res = await fetch("/api/prices"); // your backend fetches \`url\` with x-api-key
  const { data } = await res.json();
  for (const [coin, p] of Object.entries(data.prices)) {
    document.querySelector(\`[data-coin=\${coin}]\`).textContent =
      \`Rp\${p.idr.toLocaleString("id-ID")} (\${p.idr_24h_change.toFixed(1)}%)\`;
  }
}
setInterval(refresh, 30_000);

// Need second-by-second ticks for one pair? Your backend can add:
// GET /v1/finance:binance/ticker?symbol=BTCUSDT`,
  },
  {
    slug: "research-agent",
    kind: "AI agent (MCP)",
    title: "Research assistant for Claude",
    summary: "Connect Apizie as an MCP server and Claude can search PubMed and arXiv, read Wikipedia summaries and cite what it found, with no glue code.",
    who: "Students, analysts, anyone writing with an AI agent",
    uses: [["research:pubmed", "annotation-search"], ["search-tools:arxiv", "search"], ["search-tools:wikipedia", "summary"]],
    lang: "Terminal + prompt",
    code: `# 1. Give your agent the key (Claude Code shown; Claude.ai and ChatGPT use OAuth)
claude mcp add --transport http apizie https://apizie.vercel.app/mcp \\
  --header "x-api-key: $APIZIE_KEY"

# 2. Ask in plain language
> Find the 5 most recent arXiv papers on retrieval-augmented generation,
  check PubMed for any clinical use, and give me a one-paragraph summary
  of each with links.`,
  },
  {
    slug: "prayer-times-widget",
    kind: "Mobile app feature",
    title: "Prayer times and holidays",
    summary: "Shows today's prayer times for the user's city from Kemenag data and flags national holidays, so the app can adjust reminders and opening hours.",
    who: "Muslim lifestyle apps, mosques, HR and shift tools",
    uses: [["indonesia:sholat-kemenag", "jadwal-today"], ["indonesia:hari-libur", "cek"]],
    lang: "Python",
    code: `import os, requests

API = "https://apizie.vercel.app/v1"
H = {"x-api-key": os.environ["APIZIE_KEY"]}

today = requests.get(f"{API}/indonesia:sholat-kemenag/jadwal-today",
                     params={"city": "jakarta"}, headers=H).json()["data"]
day = requests.get(f"{API}/indonesia:hari-libur/cek", headers=H).json()["data"]

print(today["city"], today["jadwal"])   # subuh, dzuhur, ashar, maghrib, isya
if day["isDayOff"]:
    print("Day off:", [h["name"] for h in day["holidays"]] or day["day"])`,
  },
  {
    slug: "morning-news-digest",
    kind: "Scheduled job",
    title: "Morning news digest",
    summary: "Every morning at 07:00 it collects headlines on your topics from Google News, CNN Indonesia and The Guardian and sends one tidy email or Slack message.",
    who: "Founders, PR and comms teams, investors",
    uses: [["news:google-news", "feed"], ["news:cnn-indonesia", "latest"], ["news:guardian", "feed"]],
    lang: "Node.js (cron)",
    code: `const API = "https://apizie.vercel.app/v1";
const get = (path) => fetch(API + path, { headers: { "x-api-key": process.env.APIZIE_KEY } })
  .then((r) => r.json()).then((r) => r.data);

const [google, cnn, guardian] = await Promise.all([
  get("/news:google-news/feed?query=startup%20indonesia&limit=5"),
  get("/news:cnn-indonesia/latest?category=ekonomi&limit=5"),
  get("/news:guardian/feed?section=technology&limit=5"),
]);
await postToSlack(formatDigest({ google, cnn, guardian }));`,
  },
  {
    slug: "checkout-address-form",
    kind: "E-commerce",
    title: "Checkout address picker",
    summary: "Province, regency, district and village dropdowns that fill in as the buyer types, using official Indonesian region codes, so deliveries stop bouncing.",
    who: "Online shops, logistics and delivery apps",
    uses: [["indonesia:wilayah", "search"], ["indonesia:wilayah", "districts"], ["indonesia:wilayah", "villages"]],
    lang: "JavaScript",
    code: `// Your backend proxies these calls and adds x-api-key.
// 1. Type-ahead for city or province: "bandung" -> Kota Bandung (3273), Kab. Bandung (3204)
const { data } = await api("/v1/indonesia:wilayah/search?level=regency&q=" + encodeURIComponent(q));
citySelect.innerHTML = data.items.map((r) => \`<option value="\${r.code}">\${r.name}</option>\`).join("");

// 2. Then fill the next dropdowns from the picked code
const districts = await api("/v1/indonesia:wilayah/districts?regencyCode=" + citySelect.value);
const villages = await api("/v1/indonesia:wilayah/villages?districtCode=" + districtSelect.value);`,
  },
];
