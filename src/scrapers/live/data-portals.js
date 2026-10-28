// Open-data portals and research-data repositories, one source each, through their official open-source APIs:
// CKAN Action API (https://docs.ckan.org/en/latest/api/) and Dataverse Native/Search API (https://guides.dataverse.org/en/latest/api/).
// Every portal below answered its search API from an external checker on 2026-10-28 (success=true / status OK with
// at least one dataset). Many more portals exist; candidates whose robots.txt blocked the checker were left out.

import { url, f } from "../kit.js";
import { api, get, lim } from "./public-apis.js";

const ckanEndpoints = (base, action) => {
  const A = `${base}${action}`;
  const unwrap = (r) => r?.result ?? r;
  return [
    get("search", "Search datasets", "Full-text search over the portal's datasets, with tags, organizations, formats and resource links.", [
      f.str("query", { example: "transport", description: "Search words (Solr syntax allowed)" }), lim(10, 1000), f.int("offset", { default: 0, min: 0 }),
      f.str("organization", { description: "Organization name (slug) to filter by" }), f.str("sort", { default: "score desc, metadata_modified desc" }),
    ], (p) => url(`${A}/package_search`, { q: p.query, rows: p.limit, start: p.offset, fq: p.organization ? `organization:${p.organization}` : undefined, sort: p.sort }), { ttl: 900, map: unwrap }),
    get("dataset", "Dataset", "Full metadata of one dataset, including every resource (file or API) with its download URL.", [
      f.req("id", { example: "dataset-name", description: "Dataset name or id from the search results" }),
    ], (p) => url(`${A}/package_show`, { id: p.id }), { ttl: 3600, map: unwrap }),
    get("organizations", "Publishers", "Organizations that publish on the portal, with dataset counts.", [lim(50, 1000), f.int("offset", { default: 0, min: 0 })],
      (p) => url(`${A}/organization_list`, { all_fields: "true", limit: p.limit, offset: p.offset }), { ttl: 86400, map: unwrap }),
    get("rows", "Table rows", "Rows of a tabular resource stored in the portal's DataStore (only resources the portal has loaded into its DataStore).", [
      f.req("resourceId", { example: "00000000-0000-0000-0000-000000000000", description: "Resource id from a dataset" }), f.str("query", { description: "Full-text filter" }), lim(100, 1000), f.int("offset", { default: 0, min: 0 }),
    ], (p) => url(`${A}/datastore_search`, { resource_id: p.resourceId, q: p.query, limit: p.limit, offset: p.offset }), { ttl: 900, map: unwrap }),
  ];
};

const ckan = ({ slug, name, base, country, action = "/api/3/action", tags = [] }) =>
  api("open-data", slug, name, `Open data portal${country ? ` (${country})` : ""}: search datasets, read their metadata and resources, list publishers and query tabular rows through the portal's CKAN API.`, base, ["open-data", "ckan", "government", "datasets", ...(country ? [country.toLowerCase()] : []), ...tags], ckanEndpoints(base, action));

const dataverseEndpoints = (host) => {
  const B = `https://${host}/api`;
  const unwrap = (r) => r?.data ?? r;
  return [
    get("search", "Search", "Search datasets, files and collections in the repository.", [
      f.str("query", { default: "*", example: "climate", description: "Search words; * for everything" }), f.enm("type", ["dataset", "file", "dataverse"], { default: "dataset" }),
      lim(10, 1000), f.int("offset", { default: 0, min: 0 }), f.enm("sort", ["name", "date"], { default: "date" }), f.enm("order", ["asc", "desc"], { default: "desc" }),
    ], (p) => url(`${B}/search`, { q: p.query, type: p.type, per_page: p.limit, start: p.offset, sort: p.sort, order: p.order }), { ttl: 900, map: unwrap }),
    get("dataset", "Dataset", "Metadata of the latest published version of a dataset (citation, keywords, license, files).", [
      f.req("persistentId", { example: "doi:10.5072/FK2/EXAMPLE", description: "DOI or handle, as shown in the search results (global_id)" }),
    ], (p) => url(`${B}/datasets/:persistentId/`, { persistentId: p.persistentId }), { ttl: 3600, map: unwrap }),
    get("files", "Dataset files", "Files of the latest published version of a dataset, with ids, sizes, checksums and content types.", [
      f.req("persistentId", { example: "doi:10.5072/FK2/EXAMPLE", description: "DOI or handle of the dataset" }),
    ], (p) => url(`${B}/datasets/:persistentId/versions/:latest-published/files`, { persistentId: p.persistentId }), { ttl: 3600, map: unwrap }),
    get("info", "Repository info", "Dataverse software version of this repository.", [], () => `${B}/info/version`, { ttl: 86400, map: unwrap }),
  ];
};

const dataverse = ({ slug, name, host, country }) =>
  api("open-data", slug, name, `Research data repository${country ? ` (${country})` : ""}: search published datasets and files and read their citation metadata through the repository's Dataverse API.`, `https://${host}`, ["research-data", "dataverse", "datasets", "science", ...(country ? [country.toLowerCase()] : [])], dataverseEndpoints(host));

export const DATA_PORTALS = [
  ckan({ slug: "opendata-dk", name: "Opendata.dk (Denmark)", base: "https://admin.opendata.dk", country: "Denmark" }),
  ckan({ slug: "london-datastore", name: "London Datastore", base: "https://data.london.gov.uk", country: "United Kingdom", tags: ["london"] }),
  ckan({ slug: "south-tyrol-open-data", name: "Open Data South Tyrol", base: "https://dati.retecivica.bz.it/it", country: "Italy" }),
  ckan({ slug: "belo-horizonte-open-data", name: "Belo Horizonte Open Data", base: "https://dados.pbh.gov.br", country: "Brazil" }),
  ckan({ slug: "open-nrw", name: "open.NRW (North Rhine-Westphalia)", base: "https://open.nrw", country: "Germany" }),
  ckan({ slug: "iati-registry", name: "IATI Registry (aid transparency)", base: "https://iatiregistry.org", country: "", tags: ["aid", "development"] }),
  ckan({ slug: "aragon-open-data", name: "Aragon Open Data", base: "https://opendata.aragon.es", country: "Spain" }),
  ckan({ slug: "data-mill-north", name: "Data Mill North (Leeds)", base: "https://datamillnorth.org", country: "United Kingdom", action: "/api/action" }),
  ckan({ slug: "dati-gov-it", name: "dati.gov.it (Italy)", base: "https://www.dati.gov.it/opendata", country: "Italy" }),
  ckan({ slug: "data-nsw", name: "Data.NSW (New South Wales)", base: "https://data.nsw.gov.au/data", country: "Australia" }),
  ckan({ slug: "datamx", name: "datamx.io (Mexico)", base: "https://datamx.io", country: "Mexico" }),
  ckan({ slug: "open-data-zurich", name: "Open Data Zurich", base: "https://data.stadt-zuerich.ch", country: "Switzerland" }),
  ckan({ slug: "open-data-pakistan", name: "Open Data Pakistan", base: "https://opendata.com.pk", country: "Pakistan" }),
  ckan({ slug: "data-sa", name: "Data.SA (South Australia)", base: "https://data.sa.gov.au/data", country: "Australia" }),
  dataverse({ slug: "asu-research-data", name: "ASU Research Data Repository", host: "dataverse.asu.edu", country: "USA" }),
  dataverse({ slug: "dataverse-ua", name: "DataverseUA (National Academy of Sciences of Ukraine)", host: "opendata.nas.gov.ua", country: "Ukraine" }),
  dataverse({ slug: "issda", name: "Irish Social Science Data Archive (ISSDA)", host: "issda.ucd.ie", country: "Ireland" }),
  dataverse({ slug: "julich-data", name: "Jülich DATA", host: "data.fz-juelich.de", country: "Germany" }),
  dataverse({ slug: "lida", name: "Lithuanian Data Archive for Social Sciences and Humanities (LiDA)", host: "lida.dataverse.lt", country: "Lithuania" }),
  dataverse({ slug: "polyu-research-data", name: "PolyU Research Data Repository", host: "researchdata.lib.polyu.edu.hk", country: "Hong Kong" }),
  dataverse({ slug: "qualitative-data-repository", name: "Qualitative Data Repository (QDR)", host: "data.qdr.syr.edu", country: "USA" }),
  dataverse({ slug: "universidad-de-chile-data", name: "University of Chile Research Data", host: "datos.uchile.cl", country: "Chile" }),
  dataverse({ slug: "unimi-dataverse", name: "University of Milan Dataverse", host: "dataverse.unimi.it", country: "Italy" }),
  dataverse({ slug: "adp-slovenia", name: "Slovenian Social Science Data Archives (ADP)", host: "dataverse.adp.fdv.uni-lj.si", country: "Slovenia" }),
  dataverse({ slug: "bonndata", name: "bonndata (University of Bonn)", host: "bonndata.uni-bonn.de", country: "Germany" }),
  dataverse({ slug: "polen-datahub", name: "POLEN DataHub (Portugal)", host: "datahub.polen.fccn.pt", country: "Portugal" }),
  dataverse({ slug: "urosario-research-data", name: "Universidad del Rosario Research Data", host: "research-data.urosario.edu.co", country: "Colombia" }),
  dataverse({ slug: "soildata", name: "SoilData Repository (Brazil)", host: "repositorio.soildata.mapbiomas.org", country: "Brazil" }),
  dataverse({ slug: "sodha", name: "SODHA (Belgian social sciences and humanities data)", host: "www.sodha.be", country: "Belgium" }),
  dataverse({ slug: "ca-foscari-data", name: "Ca' Foscari University of Venice Data Repository", host: "datarepository.unive.it", country: "Italy" }),
];

export default DATA_PORTALS;
