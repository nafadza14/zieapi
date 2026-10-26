// Live scrapers backed by official / documented public APIs: research databases (NCBI, Europe PMC,
// DOAJ, ClinicalTrials.gov), developer search tools, social profiles and network/web utilities.

import { url, getJson, getText, env, f, num, stripHtml, decodeEntities, ScraperError, UA } from "../kit.js";
import { assertPublicUrl } from "../ssrf.js";

/* ───────────────────────────── shared helpers ───────────────────────────── */

const ep = (slug, displayName, description, fields, handler, extra = {}) => ({
  slug,
  displayName,
  description,
  method: "GET",
  cacheTtl: 600,
  pathTemplate: null,
  bulkEnabled: true,
  fields,
  handler,
  ...extra,
});

const page = (opts = {}) => f.int("page", { default: 1, min: 1, max: opts.max ?? 500, description: "1-based page number" });
const limit = (def = 20, max = 100, name = "limit") => f.int(name, { default: def, min: 1, max, description: "Results per page" });
const enc = encodeURIComponent;
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const csv = (s) => String(s ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** First inner text of an XML tag (namespace prefix allowed in `name`). */
function xtag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block ?? "");
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : null;
}
/** All blocks of an XML tag, with their attribute string. */
function xall(block, name) {
  return [...String(block ?? "").matchAll(new RegExp(`<${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${name}>)`, "gi"))].map((m) => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));
}
const xattr = (attrs, name) => new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(attrs ?? "")?.[1] ?? null;

function cleanDomain(raw) {
  const d = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#:].*$/, "")
    .replace(/\.$/, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(d)) throw new ScraperError("Invalid domain name", { context: { domain: raw } });
  return d;
}

/* ───────────────────────────── PubMed / NCBI ───────────────────────────── */

const NCBI_DBS = ["pubmed", "protein", "nuccore", "ipg", "nucleotide", "structure", "genome", "grasp", "annotinfo", "assembly", "bioproject", "biosample", "blastdbinfo", "books", "cdd", "clinvar", "dbvar", "gene", "gds", "geoprofiles", "medgen", "mesh", "nlmcatalog", "omim", "orgtrack", "pmc", "proteinclusters", "pcassay", "protfam", "pccompound", "pcsubstance", "seqannot", "snp", "sra", "taxonomy", "biocollections", "gtr"];
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const eutils = (path, params) => url(EUTILS + path, { ...params, tool: "zieapi", email: env("NCBI_EMAIL"), api_key: env("NCBI_API_KEY") });
const dbField = (def = "pubmed") => f.enm("db", NCBI_DBS, { default: def, description: "Entrez database" });
const PUBTATOR = "https://www.ncbi.nlm.nih.gov/research/pubtator3-api/";

function parsePubmedXml(xml) {
  return xall(xml, "PubmedArticle").map(({ body }) => {
    const abstractParts = xall(body, "AbstractText").map(({ attrs, body: t }) => {
      const label = xattr(attrs, "Label");
      const text = stripHtml(t);
      return label ? `${label}: ${text}` : text;
    });
    const authors = xall(xall(body, "AuthorList")[0]?.body, "Author").map(({ body: a }) => {
      const coll = xtag(a, "CollectiveName");
      return coll ?? [xtag(a, "ForeName"), xtag(a, "LastName")].filter(Boolean).join(" ");
    });
    const ids = Object.fromEntries(xall(xall(body, "ArticleIdList")[0]?.body, "ArticleId").map(({ attrs, body: v }) => [xattr(attrs, "IdType"), stripHtml(v)]));
    const pubDate = xall(body, "PubDate")[0]?.body ?? "";
    return {
      pmid: xtag(body, "PMID"),
      title: xtag(body, "ArticleTitle"),
      abstract: abstractParts.join("\n") || null,
      authors,
      journal: xtag(body, "Title"),
      journalAbbrev: xtag(body, "ISOAbbreviation"),
      year: xtag(pubDate, "Year") ?? xtag(pubDate, "MedlineDate"),
      volume: xtag(body, "Volume"),
      issue: xtag(body, "Issue"),
      pages: xtag(body, "MedlinePgn"),
      doi: ids.doi ?? null,
      pmcid: ids.pmc ?? null,
      keywords: xall(body, "Keyword").map((k) => stripHtml(k.body)),
      meshTerms: xall(body, "DescriptorName").map((k) => stripHtml(k.body)),
      url: `https://pubmed.ncbi.nlm.nih.gov/${xtag(body, "PMID")}/`,
    };
  });
}

function normPubmedSummary(d) {
  const ids = Object.fromEntries(arr(d.articleids).map((a) => [a.idtype, a.value]));
  return {
    pmid: d.uid,
    title: d.title,
    authors: arr(d.authors).map((a) => a.name),
    journal: d.fulljournalname ?? d.source,
    source: d.source,
    pubDate: d.pubdate,
    volume: d.volume || null,
    issue: d.issue || null,
    pages: d.pages || null,
    doi: ids.doi ?? null,
    pmcid: ids.pmc ?? null,
    pubTypes: d.pubtype ?? [],
    url: `https://pubmed.ncbi.nlm.nih.gov/${d.uid}/`,
  };
}

function normTrial(s) {
  const p = s.protocolSection ?? {};
  const id = p.identificationModule ?? {};
  const st = p.statusModule ?? {};
  const de = p.designModule ?? {};
  return {
    nctId: id.nctId,
    title: id.briefTitle,
    officialTitle: id.officialTitle ?? null,
    status: st.overallStatus ?? null,
    startDate: st.startDateStruct?.date ?? null,
    completionDate: st.completionDateStruct?.date ?? null,
    conditions: p.conditionsModule?.conditions ?? [],
    keywords: p.conditionsModule?.keywords ?? [],
    studyType: de.studyType ?? null,
    phases: de.phases ?? [],
    enrollment: de.enrollmentInfo?.count ?? null,
    sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
    interventions: arr(p.armsInterventionsModule?.interventions).map((i) => ({ type: i.type, name: i.name })),
    locationsCount: arr(p.contactsLocationsModule?.locations).length,
    hasResults: s.hasResults ?? false,
    url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : null,
  };
}

function normBioc(doc) {
  const passages = arr(doc.passages);
  return {
    pmid: doc.pmid ?? doc.id ?? null,
    pmcid: doc.pmcid ?? null,
    title: passages.find((p) => p.infons?.type === "title")?.text ?? null,
    annotations: passages.flatMap((p) =>
      arr(p.annotations).map((a) => ({ text: a.text, type: a.infons?.type ?? null, identifier: a.infons?.identifier ?? null, section: p.infons?.section_type ?? p.infons?.type ?? null })),
    ),
    relations: arr(doc.relations).map((r) => r.infons ?? r),
  };
}

const pubmed = {
  category: "research",
  slug: "pubmed",
  displayName: "PubMed",
  description: "Biomedical literature through NCBI E-utilities, plus PubTator3 annotations, iCite metrics, NCBI gene reports and ClinicalTrials.gov.",
  tags: ["pubmed", "ncbi", "biomedical", "research", "clinical-trials"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Run an Entrez query and return matching IDs (enable `summaries` to fetch PubMed metadata in the same call).",
      [
        f.req("term", { example: "covid vaccine efficacy", description: "Entrez query" }),
        dbField(),
        page(),
        limit(20, 200),
        f.enm("sort", ["relevance", "pubDate", "author", "journalName", "mostRecent"], { default: "relevance" }),
        f.str("field", { description: "Restrict search to a field, e.g. title" }),
        f.enm("datetype", ["pdat", "edat", "mdat"]),
        f.str("mindate", { description: "YYYY or YYYY/MM/DD" }),
        f.str("maxdate", { description: "YYYY or YYYY/MM/DD" }),
        f.int("reldate", { min: 1, description: "Only items from the last N days" }),
        f.bool("usehistory", { default: false }),
        f.bool("summaries", { default: false, description: "Also fetch esummary for the returned PubMed IDs" }),
      ],
      async (p, ctx) => {
        const sort = { relevance: "relevance", pubDate: "pub_date", author: "Author", journalName: "JournalName", mostRecent: undefined }[p.sort];
        const j = await getJson(
          ctx,
          eutils("esearch.fcgi", {
            db: p.db, term: p.term, retmode: "json", retstart: (p.page - 1) * p.limit, retmax: p.limit, sort, field: p.field,
            datetype: p.datetype, mindate: p.mindate, maxdate: p.maxdate, reldate: p.reldate, usehistory: p.usehistory ? "y" : undefined,
          }),
        );
        const r = j?.esearchresult;
        if (!r) throw new ScraperError("Unexpected esearch response");
        if (r.ERROR) throw new ScraperError(String(r.ERROR));
        const out = { db: p.db, total: num(r.count), page: p.page, limit: p.limit, ids: r.idlist ?? [], queryTranslation: r.querytranslation ?? null, webEnv: r.webenv ?? null, queryKey: r.querykey ?? null };
        if (p.summaries && p.db === "pubmed" && out.ids.length) {
          const s = await getJson(ctx, eutils("esummary.fcgi", { db: "pubmed", id: out.ids.join(","), retmode: "json", version: "2.0" }));
          out.items = arr(s?.result?.uids).map((u) => normPubmedSummary(s.result[u]));
        }
        return out;
      },
      { cacheTtl: 900 },
    ),
    ep(
      "summary",
      "Summary",
      "Document summaries (esummary) for one or more comma-separated IDs.",
      [f.req("id", { example: "33301246,32109013" }), dbField(), f.enm("version", ["1.0", "2.0"], { default: "2.0" })],
      async (p, ctx) => {
        const j = await getJson(ctx, eutils("esummary.fcgi", { db: p.db, id: csv(p.id).join(","), retmode: "json", version: p.version === "2.0" ? "2.0" : undefined }));
        if (j?.error || j?.esummaryresult) throw new ScraperError(String(j.error ?? j.esummaryresult?.[0] ?? "esummary failed"));
        const res = j?.result ?? {};
        const docs = arr(res.uids).map((u) => res[u]).filter(Boolean);
        return { db: p.db, count: docs.length, items: p.db === "pubmed" ? docs.map(normPubmedSummary) : docs };
      },
      { cacheTtl: 3600 },
    ),
    ep(
      "abstract",
      "Abstract",
      "Title, abstract, authors, journal and identifiers for PubMed IDs (parsed from efetch XML).",
      [f.req("id", { example: "33301246", description: "PMID or comma-separated PMIDs (max 50)" })],
      async (p, ctx) => {
        const ids = csv(p.id).slice(0, 50);
        if (!ids.every((x) => /^\d+$/.test(x))) throw new ScraperError("id must be numeric PMIDs");
        const xml = await getText(ctx, eutils("efetch.fcgi", { db: "pubmed", id: ids.join(","), rettype: "abstract", retmode: "xml" }));
        const items = parsePubmedXml(xml);
        if (!items.length) throw new ScraperError("No PubMed record found", { status: 404 });
        return ids.length === 1 ? items[0] : { count: items.length, items };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "fetch-records",
      "Fetch Records",
      "Raw efetch output (XML, text or ASN.1) for IDs in any Entrez database.",
      [
        f.req("id", { example: "33301246" }),
        dbField(),
        f.enm("rettype", ["abstract", "medline", "uilist", "fasta", "gb", "gp", "docsum", "full", "native", "xml"]),
        f.enm("retmode", ["xml", "text", "asn.1"], { default: "xml" }),
        f.int("retstart", { min: 0 }),
        f.int("retmax", { min: 1, max: 500 }),
        f.enm("strand", ["1", "2"]),
        f.int("seqStart", { min: 1 }),
        f.int("seqStop", { min: 1 }),
      ],
      async (p, ctx) => {
        const content = await getText(
          ctx,
          eutils("efetch.fcgi", { db: p.db, id: csv(p.id).join(","), rettype: p.rettype, retmode: p.retmode, retstart: p.retstart, retmax: p.retmax, strand: p.strand, seq_start: p.seqStart, seq_stop: p.seqStop }),
        );
        return { db: p.db, id: p.id, rettype: p.rettype ?? null, retmode: p.retmode, truncated: content.length > 2_000_000, content: content.slice(0, 2_000_000) };
      },
      { cacheTtl: 3600 },
    ),
    ep(
      "spell",
      "Spell",
      "Spelling suggestions for an Entrez query (espell).",
      [f.req("term", { example: "asthmaa" }), dbField()],
      async (p, ctx) => {
        const xml = await getText(ctx, eutils("espell.fcgi", { db: p.db, term: p.term }));
        const corrected = xtag(xml, "CorrectedQuery");
        return { db: p.db, query: xtag(xml, "Query") ?? p.term, corrected: corrected || null, changed: !!corrected && corrected !== p.term };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "databases",
      "Databases",
      "List all Entrez databases (einfo).",
      [],
      async (_p, ctx) => {
        const j = await getJson(ctx, eutils("einfo.fcgi", { retmode: "json" }));
        const list = j?.einforesult?.dblist ?? [];
        return { count: list.length, databases: list };
      },
      { cacheTtl: 86400, bulkEnabled: false },
    ),
    ep(
      "database-info",
      "Database Info",
      "Record count, last update, searchable fields and link names of one Entrez database.",
      [f.enm("db", NCBI_DBS, { required: true, example: "pubmed" })],
      async (p, ctx) => {
        const j = await getJson(ctx, eutils("einfo.fcgi", { db: p.db, retmode: "json" }));
        const d = arr(j?.einforesult?.dbinfo)[0];
        if (!d) throw new ScraperError("Unexpected einfo response");
        return {
          db: d.dbname,
          menuName: d.menuname,
          description: d.description,
          count: num(d.count),
          lastUpdate: d.lastupdate,
          fields: arr(d.fieldlist).map((x) => ({ name: x.name, fullName: x.fullname, description: x.description, termCount: num(x.termcount) })),
          links: arr(d.linklist).map((x) => ({ name: x.name, menu: x.menu, description: x.description, dbTo: x.dbto })),
        };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "link",
      "Link",
      "Related records in the same or another Entrez database (elink).",
      [
        f.req("id", { example: "33301246" }),
        f.enm("dbfrom", NCBI_DBS, { default: "pubmed" }),
        f.enm("db", NCBI_DBS, { default: "pubmed" }),
        f.enm("cmd", ["neighbor", "neighbor_score", "neighbor_history"], { default: "neighbor" }),
        f.str("linkname", { example: "pubmed_pubmed_citedin" }),
        f.int("maxLinks", { default: 100, min: 1, max: 1000 }),
      ],
      async (p, ctx) => {
        const j = await getJson(ctx, eutils("elink.fcgi", { dbfrom: p.dbfrom, db: p.db, id: csv(p.id), cmd: p.cmd, linkname: p.linkname, retmode: "json" }));
        if (j?.ERROR) throw new ScraperError(String(j.ERROR));
        const ls = arr(j?.linksets)[0] ?? {};
        return {
          dbfrom: ls.dbfrom ?? p.dbfrom,
          ids: ls.ids ?? csv(p.id),
          links: arr(ls.linksetdbs).map((d) => ({
            db: d.dbto,
            linkname: d.linkname,
            count: arr(d.links).length,
            ids: arr(d.links).slice(0, p.maxLinks).map((x) => (typeof x === "object" ? { id: x.id, score: num(x.score) } : x)),
          })),
          history: ls.webenv ? { webEnv: ls.webenv, linksetdbhistories: ls.linksetdbhistories ?? [] } : null,
        };
      },
      { cacheTtl: 3600 },
    ),
    ep(
      "link-check",
      "Link Check",
      "Check which links exist for IDs (elink acheck/ncheck/lcheck). Returns the raw linkset.",
      [f.req("id", { example: "33301246" }), f.enm("dbfrom", NCBI_DBS, { default: "pubmed" }), f.enm("cmd", ["acheck", "ncheck", "lcheck"], { default: "acheck" })],
      async (p, ctx) => {
        const j = await getJson(ctx, eutils("elink.fcgi", { dbfrom: p.dbfrom, id: csv(p.id), cmd: p.cmd, retmode: "json" }));
        return { dbfrom: p.dbfrom, cmd: p.cmd, linksets: j?.linksets ?? [] };
      },
      { cacheTtl: 3600 },
    ),
    ep(
      "link-provider",
      "Link Provider",
      "LinkOut providers / full-text URLs for IDs (elink llinks/prlinks). Returns the raw linkset.",
      [f.req("id", { example: "33301246" }), f.enm("dbfrom", NCBI_DBS, { default: "pubmed" }), f.enm("cmd", ["llinks", "prlinks"], { default: "prlinks" })],
      async (p, ctx) => {
        const j = await getJson(ctx, eutils("elink.fcgi", { dbfrom: p.dbfrom, id: csv(p.id), cmd: p.cmd, retmode: "json" }));
        return { dbfrom: p.dbfrom, cmd: p.cmd, linksets: j?.linksets ?? [] };
      },
      { cacheTtl: 3600 },
    ),
    ep(
      "post",
      "Post",
      "Store IDs on the Entrez history server (epost) and return the WebEnv + query key.",
      [f.req("id", { example: "33301246,32109013" }), dbField(), f.str("webEnv")],
      async (p, ctx) => {
        const xml = await getText(ctx, eutils("epost.fcgi", { db: p.db, id: csv(p.id).join(","), WebEnv: p.webEnv }));
        const err = xtag(xml, "ERROR");
        if (err) throw new ScraperError(err);
        return { db: p.db, queryKey: xtag(xml, "QueryKey"), webEnv: xtag(xml, "WebEnv") };
      },
      { cacheTtl: 0, bulkEnabled: false },
    ),
    ep(
      "citation-match",
      "Citation Match",
      "Find a PMID from journal, year, volume, first page and author (ecitmatch).",
      [
        f.req("journal", { example: "proc natl acad sci u s a" }),
        f.int("year", { required: true, example: 1991, min: 1800, max: 2100 }),
        f.str("volume", { example: "88" }),
        f.str("firstPage", { example: "3248" }),
        f.str("author", { example: "mann bj" }),
        f.str("key", { default: "q1" }),
      ],
      async (p, ctx) => {
        const clean = (s) => String(s ?? "").replace(/\|/g, " ");
        const bdata = [p.journal, p.year, p.volume, p.firstPage, p.author, p.key].map(clean).join("|") + "|";
        const text = await getText(ctx, eutils("ecitmatch.cgi", { db: "pubmed", retmode: "xml", bdata }));
        const line = text.split(/\r?\n/).find((l) => l.includes("|")) ?? "";
        const last = line.split("|").pop()?.trim() ?? "";
        const pmid = /^\d+$/.test(last) ? last : null;
        return { key: p.key, pmid, status: pmid ? "FOUND" : last || "NOT_FOUND", raw: line || null };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "id-convert",
      "Id Convert",
      "Convert between PMID, PMCID, DOI and manuscript IDs (PMC ID Converter API).",
      [f.req("ids", { example: "PMC3531190,23193287" }), f.enm("idtype", ["pmid", "pmcid", "doi", "mid"]), f.bool("versions", { default: false })],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/", { ids: csv(p.ids).join(","), idtype: p.idtype, versions: p.versions ? "yes" : "no", format: "json", tool: "zieapi", email: env("NCBI_EMAIL") }));
        if (j?.status && j.status !== "ok") throw new ScraperError(j.message ?? "ID conversion failed");
        return {
          count: arr(j?.records).length,
          records: arr(j?.records).map((r) => ({ requested: r["requested-id"] ?? null, pmid: r.pmid ?? null, pmcid: r.pmcid ?? null, doi: r.doi ?? null, error: r.errmsg ?? null, versions: r.versions })),
        };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "citation-export",
      "Citation Export",
      "Formatted citation for a PubMed/PMC article (NCBI Literature Citation Exporter).",
      [f.req("id", { example: "33301246" }), f.enm("db", ["pubmed", "pmc"], { default: "pubmed" }), f.enm("format", ["csl", "ris", "medline"], { default: "csl" })],
      async (p, ctx) => {
        const text = await getText(ctx, url(`https://api.ncbi.nlm.nih.gov/lit/ctxp/v1/${p.db}/`, { format: p.format, id: p.id }));
        if (p.format === "csl") {
          try {
            return { db: p.db, id: p.id, format: p.format, citation: JSON.parse(text) };
          } catch {
            throw new ScraperError("Citation exporter returned invalid JSON");
          }
        }
        return { db: p.db, id: p.id, format: p.format, citation: text };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "citation-metrics",
      "Citation Metrics",
      "Citation counts, Relative Citation Ratio and NIH percentile for PMIDs (NIH iCite).",
      [f.req("pmids", { example: "23456789,27599104" }), f.bool("includeCitationLists", { default: false })],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://icite.od.nih.gov/api/pubs", { pmids: csv(p.pmids).slice(0, 200).join(",") }));
        const items = arr(j?.data).map((d) => {
          const { cited_by, references, ...rest } = d;
          return p.includeCitationLists ? d : { ...rest, citedByCount: arr(cited_by).length, referencesCount: arr(references).length };
        });
        return { count: items.length, items };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "annotations",
      "Annotations",
      "PubTator3 entity annotations (genes, diseases, chemicals, …) for PMIDs.",
      [f.req("pmids", { example: "29355051" }), f.bool("full", { default: false, description: "Use PMC full text when available" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url(PUBTATOR + "publications/export/biocjson", { pmids: csv(p.pmids).join(","), full: p.full ? "true" : undefined }));
        const docs = Array.isArray(j) ? j : arr(j?.PubTator3 ?? j?.documents ?? j);
        return { count: docs.length, documents: docs.map(normBioc) };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "annotation-search",
      "Annotation Search",
      "Search PubTator3 by free text or entity ID (e.g. @CHEMICAL_remdesivir).",
      [f.req("text", { example: "@CHEMICAL_remdesivir" }), page(), f.enm("sort", ["relevance", "date"], { default: "relevance" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url(PUBTATOR + "search/", { text: p.text, page: p.page, sort: p.sort === "date" ? "date desc" : undefined }));
        return {
          total: num(j?.count),
          page: num(j?.current) ?? p.page,
          totalPages: num(j?.total_pages),
          results: arr(j?.results).map((r) => ({ pmid: String(r.pmid ?? ""), pmcid: r.pmcid ?? null, title: r.title ?? null, journal: r.journal ?? null, date: r.date ?? null, authors: r.authors ?? [], doi: r.doi ?? null, score: num(r.score) })),
        };
      },
    ),
    ep(
      "entity-autocomplete",
      "Entity Autocomplete",
      "Look up PubTator3 entity IDs by name.",
      [f.req("query", { example: "remdes" }), f.enm("concept", ["gene", "disease", "chemical", "species", "variant", "cellline"]), limit(10, 50)],
      async (p, ctx) => {
        const j = await getJson(ctx, url(PUBTATOR + "entity/autocomplete/", { query: p.query, concept: p.concept, limit: p.limit }));
        const items = arr(j).map((e) => ({ id: e._id ?? e.id ?? null, name: e.name ?? null, type: e.biotype ?? e.type ?? null, dbId: e.db_id ?? null, db: e.db ?? null, match: e.match ?? null }));
        return { count: items.length, items };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "entity-relations",
      "Entity Relations",
      "Entities related to a PubTator3 entity, optionally filtered by relation type and target.",
      [
        f.req("e1", { example: "@CHEMICAL_Doxorubicin" }),
        f.enm("type", ["ANY", "treat", "cause", "cotreat", "compare", "interact", "inhibit", "stimulate", "drug_interact", "associate", "prevent", "positive_correlate", "negative_correlate"], { default: "ANY" }),
        f.str("e2", { example: "disease" }),
        limit(20, 200),
      ],
      async (p, ctx) => {
        const j = await getJson(ctx, url(PUBTATOR + "relations", { e1: p.e1, type: p.type === "ANY" ? undefined : p.type, e2: p.e2 }));
        const items = arr(j).slice(0, p.limit);
        return { count: items.length, items };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "gene-report",
      "Gene Report",
      "Gene description, location, synonyms and optional GO terms from the NCBI Datasets v2 API.",
      [f.req("symbol", { example: "BRCA1" }), f.req("taxon", { example: "human", description: "Taxon name or NCBI tax ID" }), f.bool("includeGeneOntology", { default: false })],
      async (p, ctx) => {
        const j = await getJson(ctx, `https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/${enc(p.symbol)}/taxon/${enc(p.taxon)}`, { headers: { ...(env("NCBI_API_KEY") ? { "api-key": env("NCBI_API_KEY") } : {}) } });
        const g = arr(j?.reports)[0]?.gene;
        if (!g) throw new ScraperError("Gene not found", { status: 404 });
        const go = g.gene_ontology ?? {};
        const goList = (xs) => arr(xs).map((x) => ({ id: x.go_id, name: x.name }));
        return {
          geneId: g.gene_id,
          symbol: g.symbol,
          description: g.description ?? null,
          taxId: g.tax_id,
          organism: g.taxname ?? null,
          commonName: g.common_name ?? null,
          type: g.type ?? null,
          chromosomes: g.chromosomes ?? [],
          synonyms: g.synonyms ?? [],
          summary: arr(g.summary)[0]?.description ?? null,
          ensemblIds: g.ensembl_gene_ids ?? [],
          url: g.gene_id ? `https://www.ncbi.nlm.nih.gov/gene/${g.gene_id}` : null,
          ...(p.includeGeneOntology ? { geneOntology: { molecularFunctions: goList(go.molecular_functions), biologicalProcesses: goList(go.biological_processes), cellularComponents: goList(go.cellular_components) } } : {}),
        };
      },
      { cacheTtl: 86400, pathTemplate: ":symbol/:taxon" },
    ),
    ep(
      "trials-search",
      "Trials Search",
      "Search ClinicalTrials.gov studies (API v2) by condition, keyword and status.",
      [
        f.str("condition", { example: "diabetes" }),
        f.str("term", { example: "insulin" }),
        f.enm("status", ["NOT_YET_RECRUITING", "RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING", "SUSPENDED", "TERMINATED", "COMPLETED", "WITHDRAWN", "AVAILABLE", "NO_LONGER_AVAILABLE", "TEMPORARILY_NOT_AVAILABLE", "APPROVED_FOR_MARKETING", "WITHHELD", "UNKNOWN"]),
        limit(10, 100),
        f.str("cursor", { description: "nextCursor from a previous page" }),
      ],
      async (p, ctx) => {
        if (!p.condition && !p.term) throw new ScraperError("Provide condition or term");
        const j = await getJson(ctx, url("https://clinicaltrials.gov/api/v2/studies", { "query.cond": p.condition, "query.term": p.term, "filter.overallStatus": p.status, pageSize: p.limit, pageToken: p.cursor, countTotal: "true", format: "json" }));
        return { total: num(j?.totalCount), nextCursor: j?.nextPageToken ?? null, studies: arr(j?.studies).map(normTrial) };
      },
    ),
    ep(
      "trials-detail",
      "Trials Detail",
      "Full ClinicalTrials.gov record for an NCT ID.",
      [f.req("nctId", { example: "NCT04368728", pattern: "^NCT\\d{8}$" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url(`https://clinicaltrials.gov/api/v2/studies/${enc(p.nctId.toUpperCase())}`, { format: "json" }));
        return { ...normTrial(j ?? {}), briefSummary: j?.protocolSection?.descriptionModule?.briefSummary ?? null, eligibility: j?.protocolSection?.eligibilityModule ?? null, protocolSection: j?.protocolSection ?? null };
      },
      { cacheTtl: 3600, pathTemplate: ":nctId" },
    ),
  ],
};

/* ───────────────────────────── Europe PMC ───────────────────────────── */

const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/";
const EPMC_SOURCES = ["MED", "PMC", "PPR", "AGR", "CBA", "CTX", "ETH", "HIR", "PAT", "NBK"];
const srcField = () => f.enm("source", EPMC_SOURCES, { default: "MED" });
const EPMC_SORT = { relevance: undefined, dateAsc: "P_PDATE_D asc", dateDesc: "P_PDATE_D desc", citedAsc: "CITED asc", citedDesc: "CITED desc" };

function normEpmc(r) {
  return {
    id: r.id,
    source: r.source,
    pmid: r.pmid ?? null,
    pmcid: r.pmcid ?? null,
    doi: r.doi ?? null,
    title: r.title ? stripHtml(r.title) : null,
    authors: r.authorString ?? null,
    journal: r.journalTitle ?? r.journalInfo?.journal?.title ?? null,
    year: r.pubYear ?? null,
    firstPublished: r.firstPublicationDate ?? null,
    citedBy: num(r.citedByCount),
    openAccess: r.isOpenAccess === "Y",
    pubTypes: r.pubTypeList?.pubType ?? (r.pubType ? [r.pubType] : []),
    ...(r.abstractText ? { abstract: stripHtml(r.abstractText) } : {}),
    ...(r.keywordList ? { keywords: r.keywordList.keyword ?? [] } : {}),
    url: r.source && r.id ? `https://europepmc.org/article/${r.source}/${r.id}` : null,
  };
}

async function epmcSearch(ctx, p, method = "GET") {
  const params = { query: p.query, resultType: p.resultType, pageSize: p.limit, cursorMark: p.cursor || "*", sort: EPMC_SORT[p.sort], synonym: p.synonym ? "TRUE" : undefined, format: "json" };
  let j;
  if (method === "POST") {
    const body = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    j = await getJson(ctx, EPMC + "searchPOST", { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  } else j = await getJson(ctx, url(EPMC + "search", params));
  const results = arr(j?.resultList?.result);
  return {
    total: num(j?.hitCount),
    nextCursor: j?.nextCursorMark && j.nextCursorMark !== params.cursorMark ? j.nextCursorMark : null,
    results: p.resultType === "idlist" ? results.map((r) => ({ id: r.id, source: r.source, pmid: r.pmid ?? null, pmcid: r.pmcid ?? null, doi: r.doi ?? null })) : results.map(normEpmc),
  };
}

const epmcSearchFields = () => [
  f.req("query", { example: "malaria AND OPEN_ACCESS:y" }),
  f.enm("resultType", ["idlist", "lite", "core"], { default: "lite" }),
  f.str("cursor", { description: "nextCursor from a previous page" }),
  limit(25, 1000),
  f.enm("sort", Object.keys(EPMC_SORT), { default: "relevance" }),
  f.bool("synonym", { default: false }),
];

const epmcPaged = (path, listKey, itemKey) => async (p, ctx) => {
  const j = await getJson(ctx, url(`${EPMC}${p.source}/${enc(p.id)}/${path}`, { page: p.page, pageSize: p.limit, database: p.database, format: "json" }));
  return { total: num(j?.hitCount), page: p.page, limit: p.limit, items: arr(j?.[listKey]?.[itemKey]) };
};

const europepmc = {
  category: "research",
  slug: "europepmc",
  displayName: "Europe PMC",
  description: "Life-science literature, citations, references, cross-links, full text and text-mined annotations from the Europe PMC REST APIs.",
  tags: ["europepmc", "literature", "research", "citations", "open-access"],
  endpoints: [
    ep("search", "Search", "Search Europe PMC publications with its query syntax; paginate with `cursor`.", epmcSearchFields(), (p, ctx) => epmcSearch(ctx, p), { cacheTtl: 900 }),
    ep("search-post", "Search Post", "Same as search, but takes a JSON body (for very long queries).", epmcSearchFields(), (p, ctx) => epmcSearch(ctx, p, "POST"), { method: "POST", cacheTtl: 900 }),
    ep(
      "article",
      "Article",
      "Core metadata (incl. abstract) for one article by source + ID.",
      [f.req("id", { example: "33301246" }), srcField()],
      async (p, ctx) => {
        const r = await epmcSearch(ctx, { query: `EXT_ID:"${p.id.replace(/"/g, "")}" AND SRC:${p.source}`, resultType: "core", limit: 1 });
        if (!r.results.length) throw new ScraperError("Article not found", { status: 404 });
        return r.results[0];
      },
      { cacheTtl: 86400 },
    ),
    ep("citations", "Citations", "Articles that cite the given article.", [f.req("id", { example: "33301246" }), srcField(), page(), limit(25, 1000)], epmcPaged("citations", "citationList", "citation"), { cacheTtl: 3600 }),
    ep("references", "References", "Reference list of the given article.", [f.req("id", { example: "33301246" }), srcField(), page(), limit(25, 1000)], epmcPaged("references", "referenceList", "reference"), { cacheTtl: 86400 }),
    ep(
      "database-links",
      "Database Links",
      "Cross-references from an article to biological databases (UniProt, PDB, ENA, …).",
      [f.req("id", { example: "33301246" }), srcField(), f.str("database", { example: "UNIPROT" }), page(), limit(25, 1000)],
      epmcPaged("databaseLinks", "dbCrossReferenceList", "dbCrossReference"),
      { cacheTtl: 86400 },
    ),
    ep(
      "labs-links",
      "Labs Links",
      "External 'Labs' links (data, reviews, recommendations) for an article.",
      [f.req("id", { example: "33301246" }), srcField()],
      async (p, ctx) => {
        const j = await getJson(ctx, url(`${EPMC}${p.source}/${enc(p.id)}/labsLinks`, { format: "json" }));
        return { total: num(j?.hitCount), providers: arr(j?.providers?.provider ?? j?.providers) };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "full-text",
      "Full Text",
      "Open-access full text (JATS XML) of a PMC article, with title, abstract and plain-text body.",
      [f.req("pmcid", { example: "PMC3531190", pattern: "^(PMC)?\\d+$" })],
      async (p, ctx) => {
        const id = p.pmcid.toUpperCase().startsWith("PMC") ? p.pmcid.toUpperCase() : `PMC${p.pmcid}`;
        const xml = await getText(ctx, `${EPMC}${id}/fullTextXML`);
        const body = xall(xml, "body")[0]?.body ?? "";
        const text = stripHtml(body);
        return {
          pmcid: id,
          title: xtag(xml, "article-title"),
          abstract: xall(xml, "abstract")[0] ? stripHtml(xall(xml, "abstract")[0].body) : null,
          sections: xall(body, "sec").map((s) => xtag(s.body, "title")).filter(Boolean).slice(0, 100),
          text: text.slice(0, 200_000),
          truncated: text.length > 200_000,
          xmlLength: xml.length,
        };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "profile",
      "Profile",
      "Hit counts for a query broken down by source and publication type.",
      [f.req("query", { example: "malaria" }), f.bool("synonym", { default: false })],
      async (p, ctx) => {
        const j = await getJson(ctx, url(EPMC + "profile", { query: p.query, synonym: p.synonym ? "TRUE" : undefined, format: "json" }));
        return { query: p.query, profile: j?.profileList ?? j };
      },
      { cacheTtl: 3600 },
    ),
    ep(
      "annotations-by-article",
      "Annotations By Article",
      "Text-mined annotations (genes, diseases, organisms, …) for articles, e.g. MED:28585529 or PMC:PMC4357394.",
      [
        f.req("articleIds", { example: "MED:28585529" }),
        f.enm("type", ["Gene_Proteins", "Chemicals", "Diseases", "Organisms", "Accession Numbers", "Gene Ontology", "Sequence Ontology", "Experimental Methods", "Cell", "Cell Line", "Body Part"]),
        f.enm("section", ["Title", "Abstract", "Introduction", "Methods", "Results", "Discussion", "Conclusion"]),
        f.str("annotationProvider", { example: "Europe PMC" }),
      ],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://www.ebi.ac.uk/europepmc/annotations_api/annotationsByArticleIds", { articleIds: csv(p.articleIds).join(","), type: p.type, section: p.section, provider: p.annotationProvider, format: "JSON" }));
        return {
          articles: arr(j).map((a) => ({
            source: a.source, extId: a.extId, pmcid: a.pmcid ?? null,
            annotations: arr(a.annotations).map((x) => ({ exact: x.exact, type: x.type, section: x.section ?? null, provider: x.provider ?? null, tags: arr(x.tags).map((t) => ({ name: t.name, uri: t.uri })) })),
          })),
        };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "annotations-by-provider",
      "Annotations By Provider",
      "Page through all articles annotated by a given provider.",
      [f.req("annotationProvider", { example: "Europe PMC" }), f.str("cursor"), limit(8, 8)],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://www.ebi.ac.uk/europepmc/annotations_api/annotationsByProvider", { provider: p.annotationProvider, cursorMark: p.cursor ?? "0.0", pageSize: p.limit, format: "JSON" }));
        return { nextCursor: j?.nextCursorMark ?? null, articles: arr(j?.articles ?? j) };
      },
    ),
  ],
};

/* ───────────────────────────── DOAJ ───────────────────────────── */

const DOAJ = "https://doaj.org/api/";
const DOAJ_SORT = { relevance: undefined, createdAt: "created_date", updatedAt: "last_updated", title: "bibjson.title.exact", year: "bibjson.year" };

function normDoajArticle(r) {
  const b = r.bibjson ?? {};
  const ident = Object.fromEntries(arr(b.identifier).map((i) => [String(i.type).toLowerCase(), i.id]));
  return {
    id: r.id,
    title: b.title ?? null,
    abstract: b.abstract ? stripHtml(b.abstract) : null,
    authors: arr(b.author).map((a) => ({ name: a.name, affiliation: a.affiliation ?? null, orcid: a.orcid_id ?? null })),
    year: b.year ?? null,
    month: b.month ?? null,
    doi: ident.doi ?? null,
    journal: b.journal ? { title: b.journal.title ?? null, issns: b.journal.issns ?? [], publisher: b.journal.publisher ?? null, volume: b.journal.volume ?? null, number: b.journal.number ?? null, country: b.journal.country ?? null } : null,
    keywords: b.keywords ?? [],
    links: arr(b.link).map((l) => ({ url: l.url, type: l.type ?? null, contentType: l.content_type ?? null })),
    createdAt: r.created_date ?? null,
    updatedAt: r.last_updated ?? null,
    url: `https://doaj.org/article/${r.id}`,
  };
}
function normDoajJournal(r) {
  const b = r.bibjson ?? {};
  return {
    id: r.id,
    title: b.title ?? null,
    alternativeTitle: b.alternative_title ?? null,
    eissn: b.eissn ?? null,
    pissn: b.pissn ?? null,
    publisher: b.publisher?.name ?? null,
    country: b.publisher?.country ?? null,
    subjects: arr(b.subject).map((s) => s.term),
    languages: b.language ?? [],
    keywords: b.keywords ?? [],
    apc: b.apc ? { has: !!b.apc.has_apc, max: b.apc.max ?? [] } : null,
    licenses: arr(b.license).map((l) => l.type),
    homepage: b.ref?.journal ?? null,
    createdAt: r.created_date ?? null,
    url: `https://doaj.org/toc/${b.eissn ?? b.pissn ?? r.id}`,
  };
}

async function doajSearch(ctx, kind, query, p) {
  const j = await getJson(ctx, url(`${DOAJ}search/${kind}/${enc(query)}`, { page: p.page, pageSize: p.limit, sort: DOAJ_SORT[p.sort] ? `${DOAJ_SORT[p.sort]}:${p.order ?? "desc"}` : undefined }));
  return { total: num(j?.total), page: num(j?.page) ?? p.page, limit: num(j?.pageSize) ?? p.limit, results: arr(j?.results).map(kind === "articles" ? normDoajArticle : normDoajJournal) };
}

function parseOai(xml) {
  const err = /<error[^>]*code=["']([^"']+)["'][^>]*>([\s\S]*?)<\/error>/i.exec(xml);
  if (err && err[1] !== "noRecordsMatch") throw new ScraperError(`OAI-PMH error: ${err[1]} ${stripHtml(err[2])}`.trim());
  const records = xall(xml, "record").map(({ body }) => {
    const header = xall(body, "header")[0]?.body ?? body;
    return {
      identifier: xtag(header, "identifier"),
      datestamp: xtag(header, "datestamp"),
      sets: xall(header, "setSpec").map((s) => stripHtml(s.body)),
      title: xtag(body, "dc:title") ?? xtag(body, "oai_doaj:title") ?? xtag(body, "title"),
      identifiers: xall(body, "dc:identifier").map((s) => stripHtml(s.body)),
      publisher: xtag(body, "dc:publisher"),
      date: xtag(body, "dc:date"),
    };
  });
  const headers = records.length ? [] : xall(xml, "header").map(({ body }) => ({ identifier: xtag(body, "identifier"), datestamp: xtag(body, "datestamp"), sets: xall(body, "setSpec").map((s) => stripHtml(s.body)) }));
  const rt = /<resumptionToken([^>]*)>([^<]*)<\/resumptionToken>/i.exec(xml);
  return { count: records.length || headers.length, items: records.length ? records : headers, cursor: rt?.[2]?.trim() || null, completeListSize: num(xattr(rt?.[1], "completeListSize")) };
}

const oaiFields = (withPrefix) => [
  f.enm("verb", ["ListRecords", "ListIdentifiers"], { default: "ListRecords" }),
  ...(withPrefix ? [f.enm("metadataPrefix", ["oai_dc", "oai_doaj"], { default: "oai_dc" })] : []),
  f.str("set", { description: "OAI set spec (see harvest-sets)" }),
  f.str("from", { description: "YYYY-MM-DD" }),
  f.str("until", { description: "YYYY-MM-DD" }),
  f.str("cursor", { description: "resumptionToken from a previous page" }),
];
const oaiHarvest = (base) => async (p, ctx) => {
  const params = p.cursor ? { verb: p.verb, resumptionToken: p.cursor } : { verb: p.verb, metadataPrefix: p.metadataPrefix ?? "oai_dc", set: p.set, from: p.from, until: p.until };
  return parseOai(await getText(ctx, url(base, params)));
};

const doaj = {
  category: "research",
  slug: "doaj",
  displayName: "DOAJ",
  description: "Open-access journals and articles indexed by the Directory of Open Access Journals (public API + OAI-PMH).",
  tags: ["doaj", "open-access", "journals", "research"],
  endpoints: [
    ep(
      "search-articles",
      "Search Articles",
      "Search DOAJ articles (Elasticsearch query-string syntax).",
      [f.req("query", { example: "climate change" }), page(), limit(10, 100), f.enm("sort", ["relevance", "createdAt", "updatedAt", "title", "year"], { default: "relevance" }), f.enm("order", ["asc", "desc"], { default: "desc" })],
      (p, ctx) => doajSearch(ctx, "articles", p.query, p),
    ),
    ep(
      "search-journals",
      "Search Journals",
      "Search DOAJ journals.",
      [f.req("query", { example: "public health" }), page(), limit(10, 100), f.enm("sort", ["relevance", "createdAt", "updatedAt", "title"], { default: "relevance" }), f.enm("order", ["asc", "desc"], { default: "desc" })],
      (p, ctx) => doajSearch(ctx, "journals", p.query, p),
    ),
    ep(
      "article",
      "Article",
      "One DOAJ article by its DOAJ ID.",
      [f.req("articleId", { example: "0001a2b3c4d5e6f7a8b9c0d1e2f3a4b5" })],
      async (p, ctx) => normDoajArticle(await getJson(ctx, `${DOAJ}articles/${enc(p.articleId)}`)),
      { pathTemplate: ":articleId", cacheTtl: 86400 },
    ),
    ep(
      "article-by-doi",
      "Article By Doi",
      "Find a DOAJ article by DOI.",
      [f.req("doi", { example: "10.3390/su12010001" })],
      async (p, ctx) => {
        const r = await doajSearch(ctx, "articles", `doi:"${p.doi.replace(/"/g, "")}"`, { page: 1, limit: 1 });
        if (!r.results.length) throw new ScraperError("Article not found in DOAJ", { status: 404 });
        return r.results[0];
      },
      { pathTemplate: ":doi", cacheTtl: 86400 },
    ),
    ep(
      "journal",
      "Journal",
      "One DOAJ journal by its DOAJ ID.",
      [f.req("journalId", { example: "f3f2e7f23d444370ae5f5199f85bc100" })],
      async (p, ctx) => normDoajJournal(await getJson(ctx, `${DOAJ}journals/${enc(p.journalId)}`)),
      { pathTemplate: ":journalId", cacheTtl: 86400 },
    ),
    ep(
      "journal-by-issn",
      "Journal By Issn",
      "Find a DOAJ journal by print or electronic ISSN.",
      [f.req("issn", { example: "2071-1050", pattern: "^\\d{4}-?\\d{3}[\\dXx]$" })],
      async (p, ctx) => {
        const r = await doajSearch(ctx, "journals", `issn:${p.issn.toUpperCase()}`, { page: 1, limit: 1 });
        if (!r.results.length) throw new ScraperError("Journal not found in DOAJ", { status: 404 });
        return r.results[0];
      },
      { pathTemplate: ":issn", cacheTtl: 86400 },
    ),
    ep(
      "articles-by-journal",
      "Articles By Journal",
      "Articles published in the journal with this ISSN.",
      [f.req("issn", { example: "2071-1050" }), page(), limit(10, 100)],
      (p, ctx) => doajSearch(ctx, "articles", `issn:${p.issn.toUpperCase()}`, p),
    ),
    ep(
      "journals-by-country",
      "Journals By Country",
      "Journals whose publisher is in a country (ISO 3166-1 alpha-2 code).",
      [f.req("country", { example: "ID" }), page(), limit(10, 100)],
      (p, ctx) => doajSearch(ctx, "journals", `bibjson.publisher.country:${p.country.toUpperCase()}`, p),
    ),
    ep(
      "journals-by-publisher",
      "Journals By Publisher",
      "Journals from a publisher name.",
      [f.req("publisher", { example: "MDPI" }), page(), limit(10, 100)],
      (p, ctx) => doajSearch(ctx, "journals", `bibjson.publisher.name:"${p.publisher.replace(/"/g, "")}"`, p),
    ),
    ep(
      "journals-by-subject",
      "Journals By Subject",
      "Journals classified under a subject term.",
      [f.req("subject", { example: "Medicine" }), page(), limit(10, 100)],
      (p, ctx) => doajSearch(ctx, "journals", `bibjson.subject.term:"${p.subject.replace(/"/g, "")}"`, p),
    ),
    ep("harvest-articles", "Harvest Articles", "Bulk-harvest article records via DOAJ's OAI-PMH endpoint.", oaiFields(true), oaiHarvest("https://doaj.org/oai.article"), { bulkEnabled: false }),
    ep("harvest-journals", "Harvest Journals", "Bulk-harvest journal records via DOAJ's OAI-PMH endpoint.", oaiFields(false), oaiHarvest("https://doaj.org/oai"), { bulkEnabled: false }),
    ep(
      "harvest-sets",
      "Harvest Sets",
      "List the OAI-PMH sets (subject classes) DOAJ exposes.",
      [],
      async (_p, ctx) => {
        const xml = await getText(ctx, url("https://doaj.org/oai", { verb: "ListSets" }));
        const sets = xall(xml, "set").map(({ body }) => ({ spec: xtag(body, "setSpec"), name: xtag(body, "setName") }));
        return { count: sets.length, sets };
      },
      { cacheTtl: 86400, bulkEnabled: false },
    ),
  ],
};

/* ───────────────────────────── search tools ───────────────────────────── */

function parseArxiv(xml) {
  return xall(xml, "entry").map(({ body }) => {
    const links = xall(body, "link").map((l) => ({ href: xattr(l.attrs, "href"), rel: xattr(l.attrs, "rel"), title: xattr(l.attrs, "title") }));
    const absUrl = xtag(body, "id");
    return {
      id: absUrl?.replace(/^https?:\/\/arxiv\.org\/abs\//, "") ?? null,
      title: xtag(body, "title"),
      summary: xtag(body, "summary"),
      authors: xall(body, "author").map((a) => xtag(a.body, "name")),
      published: xtag(body, "published"),
      updated: xtag(body, "updated"),
      primaryCategory: xattr(xall(body, "arxiv:primary_category")[0]?.attrs, "term"),
      categories: xall(body, "category").map((c) => xattr(c.attrs, "term")).filter(Boolean),
      doi: xtag(body, "arxiv:doi"),
      comment: xtag(body, "arxiv:comment"),
      journalRef: xtag(body, "arxiv:journal_ref"),
      url: links.find((l) => l.rel === "alternate")?.href ?? absUrl,
      pdf: links.find((l) => l.title === "pdf")?.href ?? null,
    };
  });
}

const WIKI_LANGS = ["en", "id", "ms", "jv", "su", "de", "fr", "es", "pt", "it", "nl", "ru", "ja", "zh", "ko", "ar"];

const arxiv = {
  category: "search-tools",
  slug: "arxiv",
  displayName: "arXiv",
  description: "Search arXiv preprints through the official export API (Atom).",
  tags: ["arxiv", "papers", "preprints", "research"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search preprints. Plain text searches all fields; arXiv prefixes like ti:, au:, cat: are passed through.",
      [f.req("query", { example: "large language models" }), limit(10, 100, "count"), page(), f.enm("sortBy", ["relevance", "lastUpdatedDate", "submittedDate"], { default: "relevance" }), f.enm("sortOrder", ["ascending", "descending"], { default: "descending" })],
      async (p, ctx) => {
        const q = /\b(ti|au|abs|co|jr|cat|rn|id|all):/.test(p.query) ? p.query : `all:${p.query}`;
        const xml = await getText(ctx, url("https://export.arxiv.org/api/query", { search_query: q, start: (p.page - 1) * p.count, max_results: p.count, sortBy: p.sortBy, sortOrder: p.sortOrder }), { headers: { accept: "application/atom+xml" } });
        const items = parseArxiv(xml);
        return { total: num(xtag(xml, "opensearch:totalResults")), page: p.page, count: items.length, results: items };
      },
      { cacheTtl: 1800 },
    ),
  ],
};

const wikipedia = {
  category: "search-tools",
  slug: "wikipedia",
  displayName: "Wikipedia",
  description: "Full-text search and page summaries from Wikipedia via the MediaWiki and REST APIs.",
  tags: ["wikipedia", "wiki", "encyclopedia", "search"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Full-text search of a Wikipedia language edition.",
      [f.req("query", { example: "Jakarta" }), page(), limit(10, 50), f.enm("lang", WIKI_LANGS, { default: "en" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url(`https://${p.lang}.wikipedia.org/w/api.php`, { action: "query", list: "search", srsearch: p.query, sroffset: (p.page - 1) * p.limit, srlimit: p.limit, format: "json", formatversion: 2, origin: "*" }));
        if (j?.error) throw new ScraperError(j.error.info ?? "Wikipedia API error");
        return {
          total: num(j?.query?.searchinfo?.totalhits),
          page: p.page,
          results: arr(j?.query?.search).map((r) => ({ title: r.title, pageId: r.pageid, snippet: stripHtml(r.snippet), wordCount: r.wordcount ?? null, timestamp: r.timestamp ?? null, url: `https://${p.lang}.wikipedia.org/wiki/${enc(r.title.replace(/ /g, "_"))}` })),
        };
      },
    ),
    ep(
      "summary",
      "Summary",
      "Lead extract, description and thumbnail of one article.",
      [f.req("title", { example: "Jakarta" }), f.enm("lang", WIKI_LANGS, { default: "en" })],
      async (p, ctx) => {
        const j = await getJson(ctx, `https://${p.lang}.wikipedia.org/api/rest_v1/page/summary/${enc(p.title.replace(/ /g, "_"))}?redirect=true`);
        return { title: j.title, description: j.description ?? null, extract: j.extract ?? null, type: j.type ?? null, thumbnail: j.thumbnail?.source ?? null, coordinates: j.coordinates ?? null, timestamp: j.timestamp ?? null, url: j.content_urls?.desktop?.page ?? null };
      },
      { pathTemplate: ":title", cacheTtl: 3600 },
    ),
  ],
};

const hackernews = {
  category: "search-tools",
  slug: "hackernews",
  displayName: "Hacker News",
  description: "Search Hacker News stories and comments via the Algolia HN Search API.",
  tags: ["hackernews", "hn", "tech", "news", "search"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search HN by relevance or date, optionally filtered by item type.",
      [f.req("query", { example: "rust" }), page(), limit(20, 100), f.enm("tags", ["story", "comment", "ask_hn", "show_hn", "poll", "front_page"]), f.enm("sort", ["relevance", "date"], { default: "relevance" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url(`https://hn.algolia.com/api/v1/${p.sort === "date" ? "search_by_date" : "search"}`, { query: p.query, page: p.page - 1, hitsPerPage: p.limit, tags: p.tags }));
        return {
          total: num(j?.nbHits),
          page: (j?.page ?? p.page - 1) + 1,
          totalPages: num(j?.nbPages),
          results: arr(j?.hits).map((h) => ({
            id: h.objectID,
            title: h.title ?? h.story_title ?? null,
            url: h.url ?? h.story_url ?? null,
            author: h.author,
            points: num(h.points),
            comments: num(h.num_comments),
            text: h.story_text || h.comment_text ? stripHtml(h.story_text || h.comment_text) : null,
            createdAt: h.created_at,
            type: arr(h._tags).find((t) => ["story", "comment", "poll", "pollopt"].includes(t)) ?? null,
            hnUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
          })),
        };
      },
      { cacheTtl: 300 },
    ),
  ],
};

const stackoverflow = {
  category: "search-tools",
  slug: "stackoverflow",
  displayName: "Stack Overflow",
  description: "Search questions across Stack Exchange sites with the official API v2.3.",
  tags: ["stackoverflow", "stackexchange", "q&a", "programming"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Advanced question search (free text, tags, accepted-only).",
      [
        f.req("query", { example: "node fetch timeout" }),
        page(),
        limit(20, 100),
        f.enm("site", ["stackoverflow", "superuser", "serverfault", "askubuntu"], { default: "stackoverflow" }),
        f.enm("sort", ["relevance", "activity", "votes", "creation"], { default: "relevance" }),
        f.str("tagged", { description: "Semicolon-separated tags", example: "javascript;node.js" }),
        f.bool("accepted", { description: "Only questions with an accepted answer" }),
      ],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://api.stackexchange.com/2.3/search/advanced", { q: p.query, site: p.site, page: p.page, pagesize: p.limit, order: "desc", sort: p.sort, tagged: p.tagged, accepted: p.accepted === undefined ? undefined : String(p.accepted), key: env("STACKEXCHANGE_KEY") }));
        if (j?.error_id) throw new ScraperError(j.error_message ?? "Stack Exchange error");
        return {
          page: p.page,
          hasMore: !!j?.has_more,
          quotaRemaining: num(j?.quota_remaining),
          results: arr(j?.items).map((q) => ({
            id: q.question_id,
            title: decodeEntities(q.title),
            url: q.link,
            score: q.score,
            answers: q.answer_count,
            answered: q.is_answered,
            acceptedAnswerId: q.accepted_answer_id ?? null,
            views: q.view_count,
            tags: q.tags ?? [],
            author: q.owner?.display_name ? decodeEntities(q.owner.display_name) : null,
            createdAt: q.creation_date != null ? new Date(q.creation_date * 1000).toISOString() : null,
            lastActivityAt: q.last_activity_date != null ? new Date(q.last_activity_date * 1000).toISOString() : null,
          })),
        };
      },
    ),
  ],
};

const npm = {
  category: "search-tools",
  slug: "npm",
  displayName: "npm",
  description: "Search packages on the public npm registry.",
  tags: ["npm", "javascript", "packages", "registry"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search the npm registry by text (supports qualifiers like keywords:, author:).",
      [f.req("query", { example: "http client" }), limit(20, 250, "count"), page()],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://registry.npmjs.org/-/v1/search", { text: p.query, size: p.count, from: (p.page - 1) * p.count }));
        return {
          total: num(j?.total),
          page: p.page,
          results: arr(j?.objects).map(({ package: pk = {}, score = {}, searchScore, downloads }) => ({
            name: pk.name,
            version: pk.version,
            description: pk.description ?? null,
            keywords: pk.keywords ?? [],
            date: pk.date ?? null,
            publisher: pk.publisher?.username ?? null,
            license: pk.license ?? null,
            links: pk.links ?? {},
            score: num(score.final),
            searchScore: num(searchScore),
            ...(downloads ? { downloads } : {}),
          })),
        };
      },
    ),
    ep(
      "package",
      "Package",
      "Latest metadata of a package (abbreviated manifest).",
      [f.req("name", { example: "express" })],
      async (p, ctx) => {
        const name = p.name.startsWith("@") ? `@${enc(p.name.slice(1))}`.replace("%2F", "%2f") : enc(p.name);
        const j = await getJson(ctx, `https://registry.npmjs.org/${name}/latest`);
        return { name: j.name, version: j.version, description: j.description ?? null, license: j.license ?? null, homepage: j.homepage ?? null, repository: j.repository ?? null, dependencies: j.dependencies ?? {}, engines: j.engines ?? null };
      },
      { pathTemplate: ":name", cacheTtl: 1800 },
    ),
  ],
};

const openverse = {
  category: "search-tools",
  slug: "openverse",
  displayName: "Openverse",
  description: "Search openly licensed images and audio through the Openverse API.",
  tags: ["openverse", "images", "audio", "creative-commons", "media"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search CC-licensed media.",
      [f.req("query", { example: "mountain" }), limit(20, 20, "count"), page({ max: 20 }), f.enm("type", ["images", "audio"], { default: "images" }), f.str("license", { example: "by,cc0", description: "Comma-separated license codes" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url(`https://api.openverse.org/v1/${p.type}/`, { q: p.query, page: p.page, page_size: p.count, license: p.license }));
        return {
          total: num(j?.result_count),
          page: num(j?.page) ?? p.page,
          totalPages: num(j?.page_count),
          results: arr(j?.results).map((r) => ({
            id: r.id,
            title: r.title ?? null,
            url: r.url,
            thumbnail: r.thumbnail ?? null,
            creator: r.creator ?? null,
            creatorUrl: r.creator_url ?? null,
            license: r.license,
            licenseVersion: r.license_version ?? null,
            licenseUrl: r.license_url ?? null,
            attribution: r.attribution ?? null,
            provider: r.provider ?? null,
            source: r.source ?? null,
            landingUrl: r.foreign_landing_url ?? null,
            ...(p.type === "audio" ? { duration: num(r.duration) } : { width: num(r.width), height: num(r.height) }),
          })),
        };
      },
      { cacheTtl: 1800 },
    ),
  ],
};

/* ───────────────────────────── social ───────────────────────────── */

const gh = (ctx, path, params) => {
  const token = env("GITHUB_TOKEN");
  return getJson(ctx, url(`https://api.github.com/${path}`, params), {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
};
const ghName = (v, what) => {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(v)) throw new ScraperError(`Invalid ${what}`);
  return v;
};
const normGhUser = (u) => ({
  login: u.login, id: u.id, type: u.type, name: u.name ?? null, company: u.company ?? null, blog: u.blog || null, location: u.location ?? null,
  email: u.email ?? null, bio: u.bio ?? null, twitter: u.twitter_username ?? null, publicRepos: u.public_repos ?? null, publicGists: u.public_gists ?? null,
  followers: u.followers ?? null, following: u.following ?? null, avatar: u.avatar_url, url: u.html_url, createdAt: u.created_at ?? null, updatedAt: u.updated_at ?? null,
});
const normGhRepo = (r) => ({
  fullName: r.full_name, name: r.name, owner: r.owner?.login ?? null, description: r.description ?? null, url: r.html_url, homepage: r.homepage || null,
  language: r.language ?? null, topics: r.topics ?? [], license: r.license?.spdx_id ?? null, stars: r.stargazers_count, forks: r.forks_count,
  watchers: r.subscribers_count ?? r.watchers_count, openIssues: r.open_issues_count, defaultBranch: r.default_branch, fork: r.fork, archived: r.archived,
  sizeKb: r.size, createdAt: r.created_at, updatedAt: r.updated_at, pushedAt: r.pushed_at,
});
const ghPaging = () => [page({ max: 100 }), f.int("perPage", { default: 30, min: 1, max: 100 })];

const githubUser = {
  category: "social-media",
  slug: "github-user",
  displayName: "GitHub User",
  description: "Public GitHub users, organizations, repositories and releases via the REST API (set GITHUB_TOKEN for higher limits).",
  tags: ["github", "developer", "repositories", "profile"],
  endpoints: [
    ep("profile", "User Profile", "Public profile of a GitHub user.", [f.req("username", { example: "torvalds" })], async (p, ctx) => normGhUser(await gh(ctx, `users/${ghName(p.username, "username")}`)), { pathTemplate: ":username", cacheTtl: 1800 }),
    ep(
      "repos",
      "User Repositories",
      "Public repositories owned by a user.",
      [f.req("username", { example: "torvalds" }), f.enm("sort", ["created", "updated", "pushed", "full_name"], { default: "updated" }), ...ghPaging()],
      async (p, ctx) => ({ page: p.page, results: arr(await gh(ctx, `users/${ghName(p.username, "username")}/repos`, { sort: p.sort, per_page: p.perPage, page: p.page })).map(normGhRepo) }),
      { pathTemplate: ":username", cacheTtl: 1800 },
    ),
    ep(
      "repo",
      "Get Repository",
      "Metadata of a public repository.",
      [f.req("owner", { example: "nodejs" }), f.req("repo", { example: "node" })],
      async (p, ctx) => normGhRepo(await gh(ctx, `repos/${ghName(p.owner, "owner")}/${ghName(p.repo, "repo")}`)),
      { pathTemplate: ":owner/:repo", cacheTtl: 1800 },
    ),
    ep(
      "org",
      "Get Organization",
      "Public profile of an organization.",
      [f.req("org", { example: "github" })],
      async (p, ctx) => {
        const o = await gh(ctx, `orgs/${ghName(p.org, "org")}`);
        return { login: o.login, id: o.id, name: o.name ?? null, description: o.description ?? null, blog: o.blog || null, location: o.location ?? null, email: o.email ?? null, twitter: o.twitter_username ?? null, verified: o.is_verified ?? null, publicRepos: o.public_repos, followers: o.followers, avatar: o.avatar_url, url: o.html_url, createdAt: o.created_at };
      },
      { pathTemplate: ":org", cacheTtl: 3600 },
    ),
    ep(
      "releases",
      "Get Repository Releases",
      "Published releases of a repository, newest first.",
      [f.req("owner", { example: "nodejs" }), f.req("repo", { example: "node" }), ...ghPaging()],
      async (p, ctx) => ({
        page: p.page,
        results: arr(await gh(ctx, `repos/${ghName(p.owner, "owner")}/${ghName(p.repo, "repo")}/releases`, { per_page: p.perPage, page: p.page })).map((r) => ({
          id: r.id, tag: r.tag_name, name: r.name ?? null, draft: r.draft, prerelease: r.prerelease, author: r.author?.login ?? null, publishedAt: r.published_at, url: r.html_url, body: r.body ?? null,
          assets: arr(r.assets).map((a) => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url })),
        })),
      }),
      { pathTemplate: ":owner/:repo", cacheTtl: 1800 },
    ),
    ep(
      "starred",
      "Get Starred Repos",
      "Repositories a user has starred.",
      [f.req("username", { example: "torvalds" }), ...ghPaging()],
      async (p, ctx) => ({ page: p.page, results: arr(await gh(ctx, `users/${ghName(p.username, "username")}/starred`, { per_page: p.perPage, page: p.page })).map(normGhRepo) }),
      { pathTemplate: ":username", cacheTtl: 1800 },
    ),
    ep(
      "search-repos",
      "Search Repositories",
      "Search repositories with GitHub search qualifiers.",
      [f.req("q", { example: "language:go stars:>1000" }), f.enm("sort", ["stars", "forks", "help-wanted-issues", "updated"]), f.enm("order", ["asc", "desc"], { default: "desc" }), ...ghPaging()],
      async (p, ctx) => {
        const j = await gh(ctx, "search/repositories", { q: p.q, sort: p.sort, order: p.order, per_page: p.perPage, page: p.page });
        return { total: j.total_count, incomplete: j.incomplete_results, page: p.page, results: arr(j.items).map(normGhRepo) };
      },
    ),
    ep(
      "search-users",
      "Search Users",
      "Search users and organizations.",
      [f.req("q", { example: "location:jakarta followers:>500" }), f.enm("sort", ["followers", "repositories", "joined"]), f.enm("order", ["asc", "desc"], { default: "desc" }), ...ghPaging()],
      async (p, ctx) => {
        const j = await gh(ctx, "search/users", { q: p.q, sort: p.sort, order: p.order, per_page: p.perPage, page: p.page });
        return { total: j.total_count, incomplete: j.incomplete_results, page: p.page, results: arr(j.items).map((u) => ({ login: u.login, id: u.id, type: u.type, avatar: u.avatar_url, url: u.html_url })) };
      },
    ),
  ],
};

const BSKY = "https://public.api.bsky.app/xrpc/";
const bsky = (ctx, method, params) => getJson(ctx, url(BSKY + method, params));
const actorField = () => f.req("handle", { example: "bsky.app", description: "Handle or DID" });
const normBskyActor = (a = {}) => ({
  did: a.did, handle: a.handle, displayName: a.displayName ?? null, description: a.description ?? null, avatar: a.avatar ?? null, banner: a.banner ?? null,
  followers: a.followersCount ?? null, following: a.followsCount ?? null, posts: a.postsCount ?? null, createdAt: a.createdAt ?? null, indexedAt: a.indexedAt ?? null,
  labels: arr(a.labels).map((l) => l.val),
});
const normBskyPost = (p = {}) => ({
  uri: p.uri, cid: p.cid, author: { did: p.author?.did, handle: p.author?.handle, displayName: p.author?.displayName ?? null },
  text: p.record?.text ?? "", createdAt: p.record?.createdAt ?? null, langs: p.record?.langs ?? [],
  likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0, replies: p.replyCount ?? 0, quotes: p.quoteCount ?? 0,
  embedType: p.embed?.$type ?? null,
  url: p.author?.handle && p.uri ? `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}` : null,
});
function normThread(t, depth) {
  if (!t || t.$type !== "app.bsky.feed.defs#threadViewPost") return t?.$type ? { unavailable: t.$type.split("#").pop() } : null;
  return { ...normBskyPost(t.post), replies: depth > 0 ? arr(t.replies).map((r) => normThread(r, depth - 1)).filter(Boolean) : [] };
}
const bskyList = (method, key) => async (p, ctx) => {
  const j = await bsky(ctx, method, { actor: p.handle, limit: p.limit, cursor: p.cursor });
  return { subject: j?.subject ? normBskyActor(j.subject) : null, cursor: j?.cursor ?? null, results: arr(j?.[key]).map(normBskyActor) };
};

const bluesky = {
  category: "social-media",
  slug: "bluesky",
  displayName: "Bluesky",
  description: "Public Bluesky profiles, posts, threads, social graph and search via the AppView XRPC API.",
  tags: ["bluesky", "atproto", "social", "profile"],
  endpoints: [
    ep("profile", "Profile", "Profile of a Bluesky account.", [actorField()], async (p, ctx) => normBskyActor(await bsky(ctx, "app.bsky.actor.getProfile", { actor: p.handle })), { pathTemplate: ":handle", cacheTtl: 900 }),
    ep(
      "feed",
      "Author Feed",
      "Recent posts by an account.",
      [actorField(), limit(30, 100), f.str("cursor"), f.enm("filter", ["posts_with_replies", "posts_no_replies", "posts_with_media", "posts_and_author_threads"], { default: "posts_no_replies" })],
      async (p, ctx) => {
        const j = await bsky(ctx, "app.bsky.feed.getAuthorFeed", { actor: p.handle, limit: p.limit, cursor: p.cursor, filter: p.filter });
        return { cursor: j?.cursor ?? null, results: arr(j?.feed).map((it) => ({ ...normBskyPost(it.post), repostedBy: it.reason?.by?.handle ?? null })) };
      },
      { pathTemplate: ":handle", cacheTtl: 300 },
    ),
    ep(
      "search-posts",
      "Search Posts",
      "Full-text post search.",
      [f.req("q", { example: "jakarta" }), limit(25, 100), f.enm("sort", ["top", "latest"], { default: "latest" }), f.str("lang", { example: "id" }), f.str("author"), f.str("since", { description: "ISO datetime or YYYY-MM-DD" }), f.str("until"), f.str("cursor")],
      async (p, ctx) => {
        const j = await bsky(ctx, "app.bsky.feed.searchPosts", { q: p.q, limit: p.limit, sort: p.sort, lang: p.lang, author: p.author, since: p.since, until: p.until, cursor: p.cursor });
        return { total: num(j?.hitsTotal), cursor: j?.cursor ?? null, results: arr(j?.posts).map(normBskyPost) };
      },
      { cacheTtl: 300 },
    ),
    ep(
      "search-users",
      "Search Users",
      "Search accounts by handle, name or bio.",
      [f.req("q", { example: "news" }), limit(25, 100), f.str("cursor")],
      async (p, ctx) => {
        const j = await bsky(ctx, "app.bsky.actor.searchActors", { q: p.q, limit: p.limit, cursor: p.cursor });
        return { cursor: j?.cursor ?? null, results: arr(j?.actors).map(normBskyActor) };
      },
    ),
    ep("followers", "Get Followers", "Accounts following a user.", [actorField(), limit(50, 100), f.str("cursor")], bskyList("app.bsky.graph.getFollowers", "followers"), { pathTemplate: ":handle" }),
    ep("following", "Get Following", "Accounts a user follows.", [actorField(), limit(50, 100), f.str("cursor")], bskyList("app.bsky.graph.getFollows", "follows"), { pathTemplate: ":handle" }),
    ep(
      "post",
      "Get Post Thread",
      "A post with its parent chain and replies, from a bsky.app URL or at:// URI.",
      [f.req("url", { example: "https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l" }), f.int("depth", { default: 3, min: 0, max: 10 })],
      async (p, ctx) => {
        let uri = p.url.trim();
        const m = /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)/.exec(uri);
        if (m) {
          let did = decodeURIComponent(m[1]);
          if (!did.startsWith("did:")) did = (await bsky(ctx, "com.atproto.identity.resolveHandle", { handle: did }))?.did;
          if (!did) throw new ScraperError("Could not resolve handle");
          uri = `at://${did}/app.bsky.feed.post/${m[2]}`;
        } else if (!uri.startsWith("at://")) throw new ScraperError("url must be a bsky.app post URL or an at:// URI");
        const j = await bsky(ctx, "app.bsky.feed.getPostThread", { uri, depth: p.depth, parentHeight: 5 });
        const parents = [];
        for (let t = j?.thread?.parent; t && t.post; t = t.parent) parents.unshift(normBskyPost(t.post));
        return { uri, thread: normThread(j?.thread, p.depth), parents };
      },
      { cacheTtl: 300 },
    ),
    ep(
      "trends",
      "Get Trending Topics",
      "Currently trending topics on Bluesky (unspecced AppView endpoint).",
      [limit(10, 25)],
      async (p, ctx) => {
        const j = await bsky(ctx, "app.bsky.unspecced.getTrendingTopics", { limit: p.limit });
        const t = (x) => ({ topic: x.topic, displayName: x.displayName ?? null, link: x.link ? `https://bsky.app${x.link}` : null });
        return { topics: arr(j?.topics).map(t), suggested: arr(j?.suggested).map(t) };
      },
      { cacheTtl: 300, bulkEnabled: false },
    ),
  ],
};

const DISCORD = "https://discord.com/api/v10/";
const inviteCode = (raw) => {
  const c = String(raw ?? "").trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\//i, "").replace(/[/?#].*$/, "");
  if (!/^[A-Za-z0-9-]{2,64}$/.test(c)) throw new ScraperError("Invalid invite code");
  return c;
};
const discordIcon = (g) => (g?.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith("a_") ? "gif" : "png"}` : null);
async function discordGet(ctx, target) {
  try {
    return await getJson(ctx, target);
  } catch (e) {
    if (e instanceof ScraperError && e.upstreamStatus === 404) throw new ScraperError("Not found (unknown or expired)", { status: 404 });
    if (e instanceof ScraperError && e.upstreamStatus === 403) throw new ScraperError("Server widget is disabled for this guild", { status: 403 });
    throw e;
  }
}

const discord = {
  category: "social-media",
  slug: "discord",
  displayName: "Discord",
  description: "Public Discord invite metadata, server widgets and server templates.",
  tags: ["discord", "community", "invite", "server"],
  endpoints: [
    ep(
      "invite",
      "Invite Info",
      "Guild, channel and approximate member counts behind an invite code or discord.gg link.",
      [f.req("code", { example: "discord-developers" })],
      async (p, ctx) => {
        const j = await discordGet(ctx, url(`${DISCORD}invites/${enc(inviteCode(p.code))}`, { with_counts: "true", with_expiration: "true" }));
        const g = j.guild ?? null;
        return {
          code: j.code,
          type: j.type ?? null,
          expiresAt: j.expires_at ?? null,
          guild: g ? { id: g.id, name: g.name, description: g.description ?? null, icon: discordIcon(g), features: g.features ?? [], verificationLevel: g.verification_level ?? null, vanityUrlCode: g.vanity_url_code ?? null, nsfwLevel: g.nsfw_level ?? null, premiumSubscriptionCount: g.premium_subscription_count ?? null } : null,
          channel: j.channel ? { id: j.channel.id, name: j.channel.name, type: j.channel.type } : null,
          inviter: j.inviter ? { id: j.inviter.id, username: j.inviter.username, globalName: j.inviter.global_name ?? null } : null,
          approximateMembers: j.approximate_member_count ?? null,
          approximateOnline: j.approximate_presence_count ?? null,
        };
      },
      { pathTemplate: ":code", cacheTtl: 900 },
    ),
    ep(
      "widget",
      "Get Server Widget",
      "Public widget (online members, voice channels, instant invite) of a guild, by guild ID, or by invite code which is resolved first. The guild must have its widget enabled.",
      [f.str("guild", { example: "613425648685547541", pattern: "^\\d{15,25}$" }), f.str("code", { example: "discord-developers" })],
      async (p, ctx) => {
        let guild = p.guild;
        if (!guild && p.code) guild = (await discordGet(ctx, `${DISCORD}invites/${enc(inviteCode(p.code))}`))?.guild?.id;
        if (!guild) throw new ScraperError("Provide guild or code");
        const j = await discordGet(ctx, `${DISCORD}guilds/${enc(guild)}/widget.json`);
        return { id: j.id, name: j.name, instantInvite: j.instant_invite ?? null, presenceCount: j.presence_count ?? null, channels: arr(j.channels).map((c) => ({ id: c.id, name: c.name, position: c.position })), members: arr(j.members).map((m) => ({ id: m.id, username: m.username, status: m.status, avatar: m.avatar_url ?? null, activity: m.game?.name ?? null })) };
      },
      { cacheTtl: 120 },
    ),
    ep(
      "template",
      "Get Server Template",
      "Metadata and channel/role layout of a public server template.",
      [f.req("code", { example: "hgM48av5Q69A" })],
      async (p, ctx) => {
        const code = String(p.code).replace(/^(?:https?:\/\/)?discord\.new\//i, "");
        if (!/^[A-Za-z0-9-]{2,64}$/.test(code)) throw new ScraperError("Invalid template code");
        const j = await discordGet(ctx, `${DISCORD}guilds/templates/${enc(code)}`);
        const sg = j.serialized_source_guild ?? {};
        return { code: j.code, name: j.name, description: j.description ?? null, usageCount: j.usage_count ?? null, creator: j.creator?.username ?? null, createdAt: j.created_at ?? null, updatedAt: j.updated_at ?? null, sourceGuildId: j.source_guild_id ?? null, channels: arr(sg.channels).map((c) => ({ name: c.name, type: c.type })), roles: arr(sg.roles).map((r) => r.name) };
      },
      { pathTemplate: ":code", cacheTtl: 3600 },
    ),
  ],
};

/* ───────────────────────────── web tools ───────────────────────────── */

async function rdapDomain(ctx, domain) {
  let res;
  try {
    res = await ctx.fetch(`https://rdap.org/domain/${enc(domain)}`, { signal: ctx.signal, headers: { "user-agent": UA, accept: "application/rdap+json, application/json" } });
  } catch (e) {
    throw new ScraperError("Upstream unreachable", { context: { reason: e?.message } });
  }
  const text = await res.text();
  if (res.status === 404) return { found: false, status: 404 };
  if (!res.ok) throw new ScraperError(`RDAP returned ${res.status}`, { status: res.status });
  try {
    return { found: true, status: res.status, data: JSON.parse(text) };
  } catch {
    throw new ScraperError("RDAP returned invalid JSON");
  }
}

function vcardField(entity, key) {
  const props = arr(entity?.vcardArray?.[1]);
  const p = props.find((x) => x[0] === key);
  if (!p) return null;
  return Array.isArray(p[3]) ? p[3].filter(Boolean).join(", ") : p[3];
}

function normRdap(d) {
  const ev = Object.fromEntries(arr(d.events).map((e) => [e.eventAction, e.eventDate]));
  const registrar = arr(d.entities).find((e) => arr(e.roles).includes("registrar"));
  const entityList = (role) =>
    arr(d.entities)
      .filter((e) => arr(e.roles).includes(role))
      .map((e) => ({ handle: e.handle ?? null, name: vcardField(e, "fn"), org: vcardField(e, "org"), email: vcardField(e, "email"), country: vcardField(e, "adr") }));
  return {
    domain: (d.ldhName ?? "").toLowerCase() || null,
    unicodeName: d.unicodeName ?? null,
    handle: d.handle ?? null,
    status: d.status ?? [],
    registeredAt: ev.registration ?? null,
    expiresAt: ev.expiration ?? null,
    updatedAt: ev["last changed"] ?? null,
    registrar: registrar ? { name: vcardField(registrar, "fn"), ianaId: arr(registrar.publicIds).find((x) => /iana/i.test(x.type))?.identifier ?? null, url: registrar.url ?? null } : null,
    registrant: entityList("registrant")[0] ?? null,
    abuseContact: (() => {
      const abuse = arr(registrar?.entities).find((e) => arr(e.roles).includes("abuse"));
      return abuse ? { email: vcardField(abuse, "email"), phone: vcardField(abuse, "tel") } : null;
    })(),
    nameservers: arr(d.nameservers).map((n) => String(n.ldhName ?? "").toLowerCase()).filter(Boolean),
    dnssec: d.secureDNS?.delegationSigned ?? null,
    rdapServer: arr(d.links).find((l) => l.rel === "self")?.href ?? null,
  };
}

const rdap = {
  category: "web-tools",
  slug: "rdap",
  displayName: "Domain Availability",
  description: "Check whether a domain is registered using RDAP (via the rdap.org bootstrap redirector).",
  tags: ["domain", "rdap", "availability", "registrar"],
  endpoints: [
    ep(
      "availability",
      "Check Availability",
      "Registered domains return their registrar and dates; a 404 from the registry means the name is likely available.",
      [f.req("domain", { example: "example.com" })],
      async (p, ctx) => {
        const domain = cleanDomain(p.domain);
        const r = await rdapDomain(ctx, domain);
        if (!r.found) return { domain, available: true, registered: false, note: "No RDAP record found; the name is probably unregistered (or its TLD has no RDAP service)." };
        const n = normRdap(r.data);
        return { domain, available: false, registered: true, status: n.status, registrar: n.registrar?.name ?? null, registeredAt: n.registeredAt, expiresAt: n.expiresAt };
      },
      { cacheTtl: 300 },
    ),
  ],
};

const wayback = {
  category: "web-tools",
  slug: "wayback",
  displayName: "Wayback Machine",
  description: "Find the closest archived Internet Archive snapshot of a URL.",
  tags: ["archive", "wayback", "internet-archive", "history"],
  endpoints: [
    ep(
      "snapshot",
      "Snapshot",
      "Closest Wayback snapshot to an optional timestamp.",
      [f.req("url", { example: "example.com" }), f.str("timestamp", { example: "20100101", pattern: "^\\d{1,14}$", description: "YYYYMMDDhhmmss (prefix allowed)" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://archive.org/wayback/available", { url: p.url, timestamp: p.timestamp }));
        const c = j?.archived_snapshots?.closest;
        const ts = c?.timestamp;
        return {
          url: p.url,
          available: !!c?.available,
          snapshot: c ? { url: c.url?.replace(/^http:/, "https:") ?? null, timestamp: ts, archivedAt: ts && ts.length >= 14 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z` : null, status: c.status ?? null } : null,
        };
      },
      { cacheTtl: 3600 },
    ),
  ],
};

const WMO = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
  56: "Light freezing drizzle", 57: "Dense freezing drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Heavy freezing rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains", 80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
  85: "Slight snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

const weather = {
  category: "web-tools",
  slug: "weather",
  displayName: "Weather Forecast",
  description: "Current conditions and daily forecast from Open-Meteo, plus place-name geocoding.",
  tags: ["weather", "forecast", "open-meteo", "geocoding"],
  endpoints: [
    ep(
      "forecast",
      "Weather Forecast",
      "Current weather and an N-day daily forecast for coordinates (timezone auto-detected).",
      [f.num("lat", { required: true, min: -90, max: 90, example: -6.2 }), f.num("lon", { required: true, min: -180, max: 180, example: 106.82 }), f.int("days", { default: 7, min: 1, max: 16 }), f.enm("units", ["metric", "imperial"], { default: "metric" })],
      async (p, ctx) => {
        const imp = p.units === "imperial";
        const j = await getJson(
          ctx,
          url("https://api.open-meteo.com/v1/forecast", {
            latitude: p.lat, longitude: p.lon, forecast_days: p.days, timezone: "auto",
            current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day",
            daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max",
            temperature_unit: imp ? "fahrenheit" : undefined, wind_speed_unit: imp ? "mph" : undefined, precipitation_unit: imp ? "inch" : undefined,
          }),
        );
        if (j?.error) throw new ScraperError(j.reason ?? "Open-Meteo error");
        const c = j.current ?? {};
        const d = j.daily ?? {};
        return {
          latitude: j.latitude, longitude: j.longitude, elevation: j.elevation ?? null, timezone: j.timezone ?? null, units: { current: j.current_units ?? {}, daily: j.daily_units ?? {} },
          current: { time: c.time, temperature: c.temperature_2m, feelsLike: c.apparent_temperature, humidity: c.relative_humidity_2m, precipitation: c.precipitation, windSpeed: c.wind_speed_10m, windDirection: c.wind_direction_10m, isDay: c.is_day === 1, code: c.weather_code, condition: WMO[c.weather_code] ?? null },
          daily: arr(d.time).map((t, i) => ({
            date: t, code: d.weather_code?.[i] ?? null, condition: WMO[d.weather_code?.[i]] ?? null, tempMax: d.temperature_2m_max?.[i] ?? null, tempMin: d.temperature_2m_min?.[i] ?? null,
            precipitation: d.precipitation_sum?.[i] ?? null, precipitationProbability: d.precipitation_probability_max?.[i] ?? null, windSpeedMax: d.wind_speed_10m_max?.[i] ?? null,
            sunrise: d.sunrise?.[i] ?? null, sunset: d.sunset?.[i] ?? null, uvIndexMax: d.uv_index_max?.[i] ?? null,
          })),
        };
      },
      { cacheTtl: 900 },
    ),
    ep(
      "geocode",
      "Geocode",
      "Look up coordinates for a place name (to feed into forecast).",
      [f.req("name", { example: "Bandung" }), limit(5, 100, "count"), f.str("language", { default: "en" }), f.str("countryCode", { example: "ID", pattern: "^[A-Za-z]{2}$" })],
      async (p, ctx) => {
        const j = await getJson(ctx, url("https://geocoding-api.open-meteo.com/v1/search", { name: p.name, count: p.count, language: p.language, countryCode: p.countryCode?.toUpperCase(), format: "json" }));
        return { results: arr(j?.results).map((r) => ({ name: r.name, latitude: r.latitude, longitude: r.longitude, country: r.country ?? null, countryCode: r.country_code ?? null, admin1: r.admin1 ?? null, admin2: r.admin2 ?? null, timezone: r.timezone ?? null, population: r.population ?? null, elevation: r.elevation ?? null })) };
      },
      { cacheTtl: 86400 },
    ),
  ],
};

const jinaReader = {
  category: "web-tools",
  slug: "jina-reader",
  displayName: "Jina Reader",
  description: "Turn a public web page into clean LLM-friendly markdown/text using r.jina.ai (set JINA_API_KEY for higher limits).",
  tags: ["reader", "markdown", "llm", "extract", "web"],
  endpoints: [
    ep(
      "read",
      "Read",
      "Fetch a public URL through Jina Reader and return its title and main content.",
      [f.req("url", { example: "https://example.com", max: 2048 }), f.enm("format", ["markdown", "text", "html"], { default: "markdown" }), f.int("maxChars", { default: 100000, min: 1000, max: 500000 })],
      async (p, ctx) => {
        const u = await assertPublicUrl(p.url, ctx.lookup);
        const key = env("JINA_API_KEY");
        const j = await getJson(ctx, `https://r.jina.ai/${u.toString()}`, { headers: { accept: "application/json", "x-return-format": p.format, ...(key ? { authorization: `Bearer ${key}` } : {}) } });
        const d = j?.data ?? {};
        if (j?.code && j.code !== 200) throw new ScraperError(j.readableMessage ?? j.message ?? `Jina Reader returned ${j.code}`);
        const content = String(d.content ?? d.text ?? d.html ?? "");
        return { url: d.url ?? u.toString(), title: d.title ?? null, description: d.description ?? null, format: p.format, length: content.length, truncated: content.length > p.maxChars, content: content.slice(0, p.maxChars), tokens: d.usage?.tokens ?? null };
      },
      { cacheTtl: 1800, timeoutMs: 30000 },
    ),
  ],
};

const binLookup = {
  category: "web-tools",
  slug: "bin-lookup",
  displayName: "BIN Lookup",
  description: "Card scheme, type, issuing bank and country for a card BIN/IIN (binlist.net; strict rate limits).",
  tags: ["bin", "iin", "card", "payments", "bank"],
  endpoints: [
    ep(
      "lookup",
      "Lookup BIN",
      "Look up the first 6–8 digits of a payment card number.",
      [f.req("bin", { example: "45717360", pattern: "^\\d{6,8}$", description: "First 6-8 digits only. Never send a full card number" })],
      async (p, ctx) => {
        if (!/^\d{6,8}$/.test(p.bin)) throw new ScraperError("bin must be 6-8 digits");
        let j;
        try {
          j = await getJson(ctx, `https://lookup.binlist.net/${p.bin}`, { headers: { "accept-version": "3" } });
        } catch (e) {
          if (e instanceof ScraperError && e.upstreamStatus === 404) throw new ScraperError("BIN not found", { status: 404 });
          if (e instanceof ScraperError && e.upstreamStatus === 429) throw new ScraperError("binlist.net rate limit reached, try later", { status: 429 });
          throw e;
        }
        return {
          bin: p.bin,
          scheme: j?.scheme ?? null,
          type: j?.type ?? null,
          brand: j?.brand ?? null,
          prepaid: j?.prepaid ?? null,
          number: j?.number ?? null,
          country: j?.country ? { code: j.country.alpha2 ?? null, name: j.country.name ?? null, emoji: j.country.emoji ?? null, currency: j.country.currency ?? null } : null,
          bank: j?.bank ? { name: j.bank.name ?? null, url: j.bank.url ?? null, phone: j.bank.phone ?? null, city: j.bank.city ?? null } : null,
        };
      },
      { cacheTtl: 86400 },
    ),
  ],
};

/* ───────────────────────────── dev tools ───────────────────────────── */

const DNS_TYPES = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 43: "DS", 48: "DNSKEY", 64: "SVCB", 65: "HTTPS", 257: "CAA" };
const DNS_RCODE = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED" };

const dnsLookup = {
  category: "dev-tools",
  slug: "dns-lookup",
  displayName: "DNS Lookup",
  description: "Resolve DNS records over HTTPS using Cloudflare's public resolver (JSON API).",
  tags: ["dns", "doh", "records", "network"],
  endpoints: [
    ep(
      "lookup",
      "Lookup",
      "Query one record type for a domain.",
      [f.req("domain", { example: "example.com" }), f.enm("type", ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "CAA", "SRV", "PTR", "HTTPS", "DS", "DNSKEY"], { default: "A" })],
      async (p, ctx) => {
        const domain = p.type === "PTR" || p.type === "SRV" ? p.domain.trim().toLowerCase().replace(/\.$/, "") : cleanDomain(p.domain);
        const j = await getJson(ctx, url("https://cloudflare-dns.com/dns-query", { name: domain, type: p.type }), { headers: { accept: "application/dns-json" } });
        return {
          domain,
          type: p.type,
          status: DNS_RCODE[j?.Status] ?? String(j?.Status),
          dnssecValidated: !!j?.AD,
          truncated: !!j?.TC,
          answers: arr(j?.Answer).map((a) => ({ name: a.name, type: DNS_TYPES[a.type] ?? String(a.type), ttl: a.TTL, data: a.data })),
          authority: arr(j?.Authority).map((a) => ({ name: a.name, type: DNS_TYPES[a.type] ?? String(a.type), ttl: a.TTL, data: a.data })),
        };
      },
      { cacheTtl: 120 },
    ),
  ],
};

const ipGeo = {
  category: "dev-tools",
  slug: "ip-geo",
  displayName: "IP Geolocation",
  description: "Approximate location, ASN/ISP and timezone of a public IP address (ipwho.is).",
  tags: ["ip", "geolocation", "asn", "network"],
  endpoints: [
    ep(
      "lookup",
      "Lookup",
      "Geolocate an IPv4 or IPv6 address.",
      [f.req("ip", { example: "8.8.8.8" })],
      async (p, ctx) => {
        const ip = p.ip.trim();
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !/^[0-9a-f:.]+$/i.test(ip)) throw new ScraperError("ip must be an IPv4 or IPv6 address");
        const j = await getJson(ctx, `https://ipwho.is/${enc(ip)}`);
        if (j?.success === false) throw new ScraperError(j.message ?? "Lookup failed");
        return {
          ip: j.ip, type: j.type ?? null, continent: j.continent ?? null, continentCode: j.continent_code ?? null, country: j.country ?? null, countryCode: j.country_code ?? null,
          region: j.region ?? null, regionCode: j.region_code ?? null, city: j.city ?? null, postal: j.postal ?? null, latitude: j.latitude ?? null, longitude: j.longitude ?? null,
          callingCode: j.calling_code ?? null, flag: j.flag?.emoji ?? null,
          connection: j.connection ? { asn: j.connection.asn ?? null, org: j.connection.org ?? null, isp: j.connection.isp ?? null, domain: j.connection.domain ?? null } : null,
          timezone: j.timezone ? { id: j.timezone.id ?? null, utc: j.timezone.utc ?? null, offset: j.timezone.offset ?? null } : null,
        };
      },
      { cacheTtl: 3600 },
    ),
  ],
};

const whoisLookup = {
  category: "dev-tools",
  slug: "whois-lookup",
  displayName: "WHOIS Lookup",
  description: "Registration data (registrar, dates, status, nameservers) for a domain via RDAP, the modern WHOIS replacement.",
  tags: ["whois", "rdap", "domain", "registrar"],
  endpoints: [
    ep(
      "lookup",
      "Lookup",
      "RDAP registration record of a domain.",
      [f.req("domain", { example: "example.com" })],
      async (p, ctx) => {
        const domain = cleanDomain(p.domain);
        const r = await rdapDomain(ctx, domain);
        if (!r.found) throw new ScraperError("No RDAP record found (domain unregistered or TLD without RDAP)", { status: 404 });
        return normRdap(r.data);
      },
      { cacheTtl: 3600 },
    ),
  ],
};

const sslLabs = {
  category: "dev-tools",
  slug: "ssl-labs",
  displayName: "SSL Labs",
  description: "TLS configuration grade of a public host from Qualys SSL Labs (v3 API, or v4 when SSLLABS_EMAIL is set). Assessments take minutes; poll until status is READY.",
  tags: ["ssl", "tls", "security", "certificate"],
  endpoints: [
    ep(
      "analyze",
      "Analyze SSL",
      "Start or poll an assessment; cached results are reused when available.",
      [f.req("host", { example: "example.com" }), f.bool("fromCache", { default: true }), f.int("maxAge", { default: 24, min: 1, max: 720, description: "Max cached report age in hours" }), f.bool("startNew", { default: false })],
      async (p, ctx) => {
        const host = cleanDomain(p.host);
        const email = env("SSLLABS_EMAIL");
        const params = { host, all: "done", ...(p.startNew ? { startNew: "on" } : p.fromCache ? { fromCache: "on", maxAge: p.maxAge } : {}) };
        const j = await getJson(ctx, url(`https://api.ssllabs.com/api/${email ? "v4" : "v3"}/analyze`, params), email ? { headers: { email } } : {});
        if (j?.status === "ERROR") throw new ScraperError(j.statusMessage ?? "SSL Labs assessment failed");
        return {
          host: j.host,
          port: j.port ?? 443,
          status: j.status,
          statusMessage: j.statusMessage ?? null,
          startedAt: j.startTime ? new Date(j.startTime).toISOString() : null,
          testedAt: j.testTime ? new Date(j.testTime).toISOString() : null,
          engineVersion: j.engineVersion ?? null,
          endpoints: arr(j.endpoints).map((e) => ({
            ip: e.ipAddress, serverName: e.serverName ?? null, status: e.statusMessage ?? null, grade: e.grade ?? null, gradeTrustIgnored: e.gradeTrustIgnored ?? null,
            hasWarnings: e.hasWarnings ?? null, isExceptional: e.isExceptional ?? null, progress: e.progress ?? null, eta: e.eta ?? null,
            protocols: arr(e.details?.protocols).map((x) => `${x.name} ${x.version}`),
          })),
        };
      },
      { cacheTtl: 60, bulkEnabled: false, timeoutMs: 30000 },
    ),
  ],
};

const MAX_REDIRECTS = 3;
const MAX_HTML = 1_000_000;

/** Fetch a user URL with SSRF checks on every redirect hop. */
async function fetchPublic(ctx, raw, { method = "GET", accept = "*/*" } = {}) {
  let current = raw;
  const chain = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current, ctx.lookup);
    const started = Date.now();
    let res;
    try {
      res = await ctx.fetch(u.toString(), { method, redirect: "manual", signal: ctx.signal, headers: { "user-agent": UA, accept } });
    } catch (e) {
      throw new ScraperError("Fetch failed", { context: { url: u.toString(), reason: e?.message } });
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      chain.push({ url: u.toString(), status: res.status, location: loc });
      await res.body?.cancel?.().catch(() => {});
      current = new URL(loc, u).toString();
      continue;
    }
    return { res, finalUrl: u.toString(), chain, ms: Date.now() - started };
  }
  throw new ScraperError(`Too many redirects (max ${MAX_REDIRECTS})`, { context: { chain } });
}

async function readCapped(res, max = MAX_HTML) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, max);
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const buf = new Uint8Array(Math.min(size, max));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, buf.length - off));
    buf.set(part, off);
    off += part.byteLength;
    if (off >= buf.length) break;
  }
  return new TextDecoder().decode(buf);
}

const SECURITY_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"];

const httpHeaders = {
  category: "dev-tools",
  slug: "http-headers",
  displayName: "HTTP Headers Inspector",
  description: "Response status, headers and redirect chain of a public URL, with a security-header checklist.",
  tags: ["http", "headers", "redirects", "security", "network"],
  endpoints: [
    ep(
      "inspect",
      "Inspect Headers",
      "Request a URL (HEAD or GET) and report the headers; follows up to 3 redirects.",
      [f.req("url", { example: "https://example.com", max: 2048 }), f.enm("method", ["HEAD", "GET"], { default: "HEAD" })],
      async (p, ctx) => {
        let r = await fetchPublic(ctx, p.url, { method: p.method });
        let method = p.method;
        if (method === "HEAD" && (r.res.status === 405 || r.res.status === 501)) {
          await r.res.body?.cancel?.().catch(() => {});
          r = await fetchPublic(ctx, p.url, { method: "GET" });
          method = "GET";
        }
        const { res, finalUrl, chain, ms } = r;
        await res.body?.cancel?.().catch(() => {});
        const headers = {};
        res.headers.forEach((v, k) => {
          headers[k] = k in headers ? `${headers[k]}, ${v}` : v;
        });
        return {
          url: p.url,
          finalUrl,
          method,
          status: res.status,
          statusText: res.statusText || null,
          timeMs: ms,
          redirects: chain,
          headers,
          security: Object.fromEntries(SECURITY_HEADERS.map((h) => [h, res.headers.has(h)])),
        };
      },
      { cacheTtl: 60, timeoutMs: 15000 },
    ),
  ],
};

function parseAttrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

export function extractMeta(html, base) {
  const head = html.split(/<\/head>/i)[0];
  const abs = (v) => {
    if (!v) return null;
    try {
      return new URL(v, base).toString();
    } catch {
      return v;
    }
  };
  const meta = {};
  const og = {};
  const twitter = {};
  for (const m of head.matchAll(/<meta\s[^>]*>/gi)) {
    const a = parseAttrs(m[0]);
    const key = (a.property ?? a.name ?? a["http-equiv"] ?? a.itemprop ?? "").toLowerCase();
    const content = a.content;
    if (!key || content === undefined) continue;
    const val = content.replace(/\s+/g, " ").trim();
    if (key.startsWith("og:")) og[key.slice(3)] ??= val;
    else if (key.startsWith("twitter:")) twitter[key.slice(8)] ??= val;
    else meta[key] ??= val;
  }
  const links = [...head.matchAll(/<link\s[^>]*>/gi)].map((m) => parseAttrs(m[0]));
  const rel = (r) => links.find((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes(r))?.href ?? null;
  const titleRaw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = titleRaw ? decodeEntities(titleRaw).replace(/\s+/g, " ").trim() : null;
  return {
    title: title || og.title || null,
    description: meta.description ?? og.description ?? twitter.description ?? null,
    lang: /<html[^>]*\slang=["']?([^"'\s>]+)/i.exec(html)?.[1] ?? null,
    canonical: abs(rel("canonical")),
    icon: abs(rel("icon") ?? rel("shortcut") ?? rel("apple-touch-icon")) ?? abs("/favicon.ico"),
    image: abs(og.image ?? twitter.image ?? null),
    siteName: og.site_name ?? null,
    og,
    twitter,
    meta,
  };
}

const metaPreview = {
  category: "dev-tools",
  slug: "meta-preview",
  displayName: "Meta/OG Preview",
  description: "Title, description, OpenGraph/Twitter cards, canonical URL and icon of a public web page (link-preview data).",
  tags: ["meta", "opengraph", "seo", "preview", "link"],
  endpoints: [
    ep(
      "lookup",
      "Lookup",
      "Fetch up to 1 MB of a public HTML page and extract its preview metadata.",
      [f.req("url", { example: "https://example.com", max: 2048 })],
      async (p, ctx) => {
        const { res, finalUrl, chain } = await fetchPublic(ctx, p.url, { accept: "text/html,application/xhtml+xml" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok) {
          await res.body?.cancel?.().catch(() => {});
          throw new ScraperError(`Page returned ${res.status}`, { status: res.status });
        }
        if (!/html|xml/i.test(type)) {
          await res.body?.cancel?.().catch(() => {});
          throw new ScraperError(`Not an HTML page (${type || "unknown type"})`);
        }
        const html = await readCapped(res);
        return { url: p.url, finalUrl, status: res.status, redirects: chain.length, contentType: type, ...extractMeta(html, finalUrl) };
      },
      { cacheTtl: 900, timeoutMs: 15000 },
    ),
  ],
};

export default [
  pubmed,
  europepmc,
  doaj,
  arxiv,
  wikipedia,
  hackernews,
  stackoverflow,
  npm,
  openverse,
  githubUser,
  bluesky,
  discord,
  rdap,
  wayback,
  weather,
  jinaReader,
  binLookup,
  dnsLookup,
  ipGeo,
  whoisLookup,
  sslLabs,
  httpHeaders,
  metaPreview,
];
