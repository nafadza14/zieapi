// /sources and /sources/:id: what each official source covers, how it is licensed and how to call it with
// citations. These pages are the factual reference AI answer engines and buyers read before trusting the data.
import { layout, esc, pageHead } from "../html.js";
import { webPageLd, breadcrumb, faqLd, absUrl } from "../seo.js";
import { OFFICIAL_SOURCES, AFFILIATION_NOTE } from "../../core/sources.js";

const sampleSource = (s) =>
  JSON.stringify(
    {
      official: true,
      provider: s.name,
      publisher: s.publisher,
      url: s.homepage,
      retrievedAt: "2026-10-30T09:12:44.000Z",
      license: s.license,
      licenseUrl: s.termsUrl,
      attribution: `Source: ${s.publisher} (${s.name}), retrieved 2026-10-30`,
      ...(s.notice ? { notice: s.notice } : {}),
    },
    null,
    2,
  );

const qs = (params) => {
  const e = Object.entries(params ?? {});
  return e.length ? "?" + e.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
};

function datasetLd(s) {
  return {
    "@type": "Dataset",
    "@id": absUrl(`/sources/${s.id}`) + "#dataset",
    name: `${s.name} via Apizie`,
    description: `${s.covers}. Served by Apizie as normalized JSON with a source citation on every response.`,
    url: absUrl(`/sources/${s.id}`),
    creator: { "@type": "Organization", name: s.publisher, url: s.homepage },
    license: s.termsUrl,
    isAccessibleForFree: true,
    spatialCoverage: s.country,
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: absUrl(`/api/${s.project.replace(":", "/")}`) }],
  };
}

export function sourcesIndexPage({ user, sources, combined = [] }) {
  const body = `<main>
${pageHead("Apizie Finance · Official sources", "Six publishers. Every answer cited.", "Apizie Finance serves data straight from each publisher's own public API, normalized into one format, with the publisher, official URL, retrieval time and licence attached to every response. A premium add-on from $49 a month.")}
<section class="section wrap">
  <div class="grid-3 source-grid">${sources
    .map(
      (s) => `<article class="card source-card"><span class="eyebrow">${esc(s.country)}</span><h3><a href="/sources/${esc(s.id)}">${esc(s.name)}</a></h3><p class="muted small">${esc(s.publisher)}</p><p>${esc(s.covers)}.</p><p class="muted small">Licence: ${esc(s.license)}</p><div class="sc-meta"><span>${s.endpoints} endpoints</span><a href="/sources/${esc(s.id)}">Details →</a></div></article>`,
    )
    .join("")}</div>
  <div class="source-combined card">
    <div><span class="eyebrow">Combined endpoints</span><h3>Several sources, one call</h3><ul class="plain-list">${combined.map((c) => `<li><code>${esc(c.key)}/${esc(c.slug)}</code>: ${esc(c.description)}</li>`).join("")}</ul></div>
    <a class="pill pill-white" href="/category/official">Open in the catalog →</a>
  </div>
</section>
<section class="section wrap narrow">
  <h2 class="display-3">How citations work</h2>
  <p>Every successful response has the shape <code>{ project, data, source, timestamp }</code>. The <code>source</code> block names the publisher, links a page a person can open to check the value, gives the official API URL that was called (credentials removed), the time it was retrieved, the licence and a ready-to-use attribution line. Cached responses keep the original retrieval time. Values taken from a filing, such as revenue in <code>official:company/profile</code>, also link to that filing.</p>
  <p>We follow each publisher's terms: FRED series that FRED marks as copyrighted by a third party are not served, SEC requests identify Apizie and stay under the SEC's fair-access rate, and attribution text is included for sources that ask for it.</p>
  <p class="muted small">${esc(AFFILIATION_NOTE)} This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.</p>
</section>
</main>`;
  const description = "Official sources served by Apizie: SEC EDGAR, FRED, ECB, U.S. Treasury Fiscal Data, GLEIF LEI and World Bank Open Data, with licence notes and a citation on every response.";
  return layout({ title: "Official data sources: SEC EDGAR, FRED, ECB, Treasury, GLEIF, World Bank", user, body, description, active: "sources", markdown: true, jsonLd: [webPageLd({ name: "Apizie official sources", description, type: "CollectionPage" }), breadcrumb([["Home", "/"], ["Sources", "/sources"]]), ...sources.map(datasetLd)] });
}

export function sourcePage({ user, source: s, endpoints = [], apiUrl }) {
  const ex = s.example ?? { endpoint: endpoints[0]?.slug, params: {} };
  const curl = `curl "${apiUrl}/v1/${s.project}/${ex.endpoint}${qs(ex.params)}" \\\n  -H "x-api-key: $APIZIE_KEY"`;
  const faq = [
    [`How do I get access?`, `${s.name} is part of Apizie Finance, a premium add-on from $49 a month that runs next to any Apizie plan. See /finance#pricing.`],
    [`Is this the official ${s.name} data?`, `Yes. Apizie calls ${s.publisher}'s own public API (${s.hosts[0]}) and returns the result as JSON. Every response links the official page and API URL it came from. ${AFFILIATION_NOTE}`],
    [`How do I cite ${s.name} data from Apizie?`, `Use the source block in the response: source.attribution is a ready-made line, source.url is a page a reader can open, and source.retrievedAt is when the data was fetched.`],
    [`What licence applies?`, `${s.license}. Read the publisher's terms at ${s.termsUrl}. These sources are part of Apizie Finance, and your Finance plan sets how you may use the data: inside your company on Finance Starter, in your own product with attribution on Finance Growth and Business. Redistribution needs an Enterprise agreement.`],
    [`Can I get notified when ${s.name} publishes something new?`, `Yes, with Apizie Finance. Data alerts send a signed data.changed webhook and a dashboard notification when the source updates.`],
  ];
  const body = `<main>
${pageHead(s.country, s.name, `${s.publisher}. ${s.covers}.`)}
<section class="section wrap">
  <div class="split">
    <div>
      <h2 class="display-3">Endpoints</h2>
      <table class="src-table"><thead><tr><th>Endpoint</th><th>What it returns</th></tr></thead><tbody>${endpoints
        .map((e) => `<tr><td><a href="/api/${esc(s.project.replace(":", "/"))}?endpoint=${encodeURIComponent(e.slug)}"><code>${esc(e.slug)}</code></a></td><td>${esc(e.description ?? e.displayName)}</td></tr>`)
        .join("")}</tbody></table>
      <h2 class="display-3">Licence and terms</h2>
      <p>${esc(s.license)}. <a href="${esc(s.termsUrl)}" rel="noopener">Publisher terms</a>.</p>
      ${s.notice ? `<p class="muted">${esc(s.notice)}</p>` : ""}
      <p class="muted small">${esc(AFFILIATION_NOTE)}</p>
    </div>
    <div class="stack">
      <div class="code-card"><div class="code-tabs"><button class="on">Request</button></div><pre class="code"><code>${esc(curl)}</code></pre></div>
      <div class="code-card"><div class="code-tabs"><button class="on">source block in the response</button></div><pre class="code"><code>${esc(sampleSource(s))}</code></pre></div>
      <p class="muted small">From an AI agent: connect the <a href="/mcp">MCP server</a> and ask, for example, “${esc(promptFor(s))}”. The answer comes back with this source.</p>
    </div>
  </div>
</section>
<section class="section wrap narrow" id="faq"><h2 class="display-3">Questions</h2><div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div></section>
</main>`;
  const description = `${s.name} data (${s.publisher}) as JSON for AI agents, with the official source and licence on every response. ${s.covers}.`;
  return layout({ title: `${s.name} API for AI agents, with citations`, user, body, description, active: "sources", markdown: true, jsonLd: [webPageLd({ name: `${s.name} via Apizie`, description }), breadcrumb([["Home", "/"], ["Sources", "/sources"], [s.name, `/sources/${s.id}`]]), datasetLd(s), faqLd(faq)] });
}

const promptFor = (s) =>
  ({
    "sec-edgar": "What revenue did Apple report in its latest 10-K? Cite the filing.",
    fred: "What is the current effective federal funds rate, and when was it last updated?",
    ecb: "What is the ECB deposit facility rate today?",
    "us-treasury": "What is the 10-year Treasury par yield on the latest curve?",
    gleif: "What is Siemens AG's Legal Entity Identifier and registered address?",
    "world-bank": "What was Germany's GDP growth in the latest year available?",
  })[s.id] ?? `Show me the latest ${s.name} data.`;

export function sourcesMd({ sources, publicUrl, apiUrl }) {
  return `# Official sources on Apizie

> Apizie serves data from each publisher's own public API, normalized into \`{ project, data, source, timestamp }\`. The \`source\` block (publisher, official URL, retrieval time, licence, attribution) is on every response.

${sources.map((s) => `## ${s.name}\n- Publisher: ${s.publisher}\n- Covers: ${s.covers}\n- Project: \`${s.project}\` (${s.endpoints} endpoints): ${publicUrl}/sources/${s.id}\n- Licence: ${s.license} (${s.termsUrl})${s.notice ? `\n- ${s.notice}` : ""}\n- Example: \`GET ${apiUrl}/v1/${s.project}/${s.example?.endpoint ?? ""}${qs(s.example?.params)}\``).join("\n\n")}

${AFFILIATION_NOTE}
`;
}

export { OFFICIAL_SOURCES };
