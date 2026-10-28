# Where Apizie's APIs come from (October 2026)

| Source | APIs | Endpoints | Key needed |
|---|---|---|---|
| OpenAPI directory (`src/catalog/openapi`, built by `scripts/build-directory.sh`) | 3,319 | 142,493 operations | depends on the provider; 341 keyless ones are live, the rest are bring-your-own-key |
| Native live modules (`src/scrapers/live/*.js`) | 404 | 930 | none (a few optional env keys) |
| Catalog total (`app.catalog.totals()`, public) | 3,723 | 143,423 | 712 live APIs / 10,757 live endpoints |

Planned sources (202) are not counted; they are visible in `/admin` only.

## Keyless public APIs added in iteration 8

- **Weather, earth and space:** Open-Meteo, MET Norway, 7Timer, US National Weather Service, NOAA tides, aviation weather, USGS earthquakes, NASA EONET, UK carbon intensity, UK flood monitoring, sunrise and sunset, ISS location, CelesTrak, SpaceX, Launch Library, Spaceflight News.
- **Places and transport:** Nominatim, Zippopotam, REST Countries, Universities, OpenSky, CityBikes, Swiss transport, iRail, ipwho, India PIN codes, Japan postcodes, BrasilAPI.
- **Finance and crypto:** Frankfurter, currency-api, DBnomics, Stooq, Bank of Canada, Banco Central do Brasil, CoinPaprika, CoinLore, Blockchair, DEX Screener, and exchanges Kraken, Coinbase, Bitstamp, KuCoin, Gate.io, Bitfinex, Gemini, HTX, MEXC, Bitget, Crypto.com, Upbit, Deribit.
- **Research, knowledge and open data:** OpenAlex, Crossref, Semantic Scholar, Open Library, Gutendex, Internet Archive, Library of Congress, Wikidata, Wikimedia pageviews, Datamuse, Free Dictionary, GBIF, iNaturalist, data.gov, data.gov.uk, Open Canada, data.europa.eu, Eurostat, Federal Register, UN SDG, ReliefWeb, Met Museum, Art Institute of Chicago.
- **Health and security:** openFDA, RxNorm, disease.sh, NVD CVE, EPSS, CISA KEV, OSV, Shodan InternetDB, Have I Been Pwned (Pwned Passwords k-anonymity), crt.sh.
- **Developer tools:** PyPI, crates.io, RubyGems, Packagist, NuGet, Go modules, Maven Central, Docker Hub, GitLab, deps.dev, Bundlephobia, npms, jsDelivr stats, Homebrew, Arch Linux, endoflife.date, Statuspage status of major services, Codeforces, math.js, TimeAPI, Color API, MyMemory translate, Random User, DummyJSON, Fake Store, JSONPlaceholder.
- **Games, sports and entertainment:** Chess.com, FreeToGame, Steam store, OpenDota, League Data Dragon, Valorant, Minecraft, Guild Wars 2, speedrun.com, Scryfall, Yu-Gi-Oh, Pokemon TCG, Formula 1 (Jolpica), OpenF1, MLB Stats, NHL, TheSportsDB, Rick and Morty, Star Wars, Studio Ghibli, Kitsu, Disney characters, Cover Art Archive, Radio Browser, Lemmy, Open Trivia DB, Deck of Cards, JokeAPI and more.
- **Faith and calendars:** AlAdhan prayer times, Quran Cloud, Hebcal, Bible API, public holidays.

## What is left out on purpose

- **Azure Stack Hub admin** and other private deployments (no public server), **Azure Storage** (SharedKey signing), Kubernetes.
- **Mailchimp Transactional** and other specs whose auth cannot be expressed as a header key.
- Provider specs (Konfig collection) that declare no auth at all, unless the API is known to be open: shown as "live" they would fail with 401.
- Preview-only Azure services, sandbox/demo servers, Google APIs that were shut down (Fusion Tables, URL Shortener, QPX Express and others).
- Anything that needs scraping around bot protection, or a private or unofficial API.

## How it is checked

`test/public-apis.test.js` runs every keyless endpoint offline with its documented example parameters and a mock `fetch`: unique keys and slugs, a source URL, required fields with examples, no em dashes, and exactly one valid public `https` call without `undefined` or `NaN`. The build sandbox cannot reach most upstream hosts, so live responses were not checked here; the first real calls happen after deploy, and `/admin` shows upstream errors per endpoint.

To refresh the directory: `node scripts/import-openapi.js <openapi-directory>/APIs [extra spec dirs...]`.

## Iteration 9 (28 October 2026): global news and popular tools

- **104 international news sources** from publishers' own RSS/Atom feeds (`src/scrapers/live/news-global.js`), many with sections: NPR, New York Times, Fox News, CBS, Sky News, WSJ, The Economist, Bloomberg, Deutsche Welle, France 24, Euronews, Al Jazeera, SCMP, Straits Times, The Hindu, ABC Australia, TechCrunch, Engadget, MIT Technology Review, Nature, NASA, WHO, BBC Sport, IGN, Decrypt and more.
  - 67 feeds were fetched successfully from an external checker on 2026-10-28. 37 are official feeds that checker could not reach (robots.txt or network block); they carry `verified: false` in the source file. Extra sections follow each publisher's documented URL pattern and were not all checked one by one. Source health in `/admin` shows real error rates once traffic flows.
- **RSS & Atom Reader** (`web-tools:rss-reader`): `read` any public feed as JSON, `discover` the feeds a website advertises, `merge` up to 10 feeds into one timeline. Caller URLs are SSRF-checked on every redirect hop.
- **24 popular keyless APIs** (`src/scrapers/live/public-apis-3.js`): OpenStreetMap Overpass (places nearby with phone and website), Photon geocoder, Open Topo Data elevation, Postcodes.io, CountriesNow, GDACS disaster alerts, NOAA space weather, USGS volcano alerts, NASA Image Library, ADS-B live flights, TfL status, Blockchain.com ticker, ExchangeRate-API open access, Arbeitnow and Remote OK jobs, Hacker News search, GitHub trending, Iconify, Google Public DNS, is.gd, ZenQuotes, Useless Facts, EmojiHub, OpenLigaDB.
  - Live-checked on 2026-10-28 except Overpass and Photon (checker blocked by robots.txt).
- Left out after checking: CoinCap v2 (shut down), OpenAQ v3 and Google Books (key required), Lingva (unofficial Google Translate front end), OSRM demo server and Remotive (usage terms forbid this kind of reuse), ipapi.co (not for production), CNN (feeds stale), and feeds that returned errors (Washington Post, Japan Times, Bangkok Post, CBC, Mail & Guardian, Rappler, Newsweek, UN News, ESPN, Phys.org).

## Iteration 10 (28 October 2026): twice the catalog

The public catalog went from 1,828 to 3,723 APIs (endpoints from 46,364 to 143,423). Everything comes from descriptions the providers publish themselves, cloned from GitHub; nothing was scraped and no planned source was promoted.

| Source | Repository | APIs | How calls are authorized |
|---|---|---|---|
| AWS | APIs.guru specs plus `aws/aws-sdk-js` models for 39 newer services (Bedrock, Q Business, DataZone...) | 382 | AWS Signature V4, caller sends `ACCESS_KEY_ID:SECRET_ACCESS_KEY[:SESSION_TOKEN]` |
| Azure Resource Manager | `Azure/azure-rest-api-specs`, latest stable version of every service, merged per service | 236 services | Microsoft Entra access token |
| Azure data plane | same repository, `data-plane/**/stable` (AI Language, Document Intelligence, Key Vault, OpenAI...) | 100 | key or Entra token; the resource endpoint is a required field and must be on a Microsoft domain |
| Google | `googleapis/google-api-go-client` Discovery documents (newer copies replace the APIs.guru ones; 52 new APIs such as Merchant, Meet, Pollen, Solar, Air Quality) | 350 | API key (`?key=`) or OAuth token |
| Alibaba Cloud | `aliyun/aliyun-openapi-meta` (English docs) | 341 | ACS3-HMAC-SHA256, caller sends `ACCESS_KEY_ID:ACCESS_KEY_SECRET`; regional endpoint chosen from the provider's list |
| Tencent Cloud | `TencentCloud/tencentcloud-cli` API 3.0 metadata (English product names added by hand in `scripts/data/tencent-names.json`) | 254 | TC3-HMAC-SHA256, caller sends `SECRET_ID:SECRET_KEY` |
| HubSpot | `HubSpot/HubSpot-public-api-spec-collection` (newest dated version of each API; replaces the 12 older APIs.guru copies) | 77 in total (66 new) | private app token |
| Microsoft Fabric | `microsoft/fabric-rest-api-specs` | 58 | Entra token |
| Confluent Cloud | `confluentinc/ccloud-sdk-go-v2` | 52 | API key and secret (basic) |
| SendGrid | `twilio/sendgrid-oai` | 46 | API key |
| Akamai | `akamai/akamai-apis` (newest version of each API) | 51 | EdgeGrid, caller sends `CLIENT_TOKEN:CLIENT_SECRET:ACCESS_TOKEN` and the API client host (must be on akamaiapis.net) |
| Konfig collection | `konfig-sdks/openapi-examples` (specs collected from providers' public docs; production servers and declared auth only; one unofficial spec and duplicates of specs listed elsewhere are skipped) | 231 | per provider |
| Others | LINE (7), Webex (8, Contact Center left out: it runs on a different host), MongoDB Atlas, Ory Network, Paystack, Lithic, Modern Treasury, Marqeta, Unit, bunq, Klaviyo, Zendesk, RingCentral, Opsgenie, Elastic Cloud, Cisco Meraki, Linode | 30 | per provider |
| Open data | 14 CKAN portals (London Datastore, Data.NSW, dati.gov.it, open.NRW, Open Data Zurich, IATI Registry...) and 16 Dataverse research repositories | 30 | none (live) |

New connector features that made this possible (`src/core/connector.js`, `aws-sigv4.js`, `cloud-signers.js`):

- **Request signing** for AWS (SigV4), Tencent Cloud (TC3), Alibaba Cloud (ACS3) and Akamai (EdgeGrid). Signatures are checked against the AWS SigV4 test suite and against Tencent's, Alibaba's and Akamai's own SDKs (`test/cloud-apis.test.js`). Keys are used for one request and never stored or logged.
- **Caller-chosen server parts**: tenant subdomains (`{domain}.atlassian.net`), regions (`dynamodb.{region}.amazonaws.com`, from the provider's list) and whole resource endpoints (Azure `{endpoint}`). A subdomain part only accepts hostname labels, so the provider's domain always stays in place; a whole endpoint must be a plain https URL, on the provider's domains when the provider has a fixed set, and goes through the usual SSRF check.
- **Fixed per-operation headers and query** (`X-Amz-Target`, `Action`/`Version`, `X-TC-Action`, `x-acs-action`), JSON-body fields, XML bodies and Google `{+name}` resource paths.
- Azure `api-version` gets a default from the spec version on every operation.
- Cleanup that also touched older entries: production servers are preferred over sandbox ones (PayPal, Paddle, bunq and others now point at production), APIs that only had a mock server (`polls.apiblueprint.org`, SwaggerHub virtual servers) were removed, placeholder hosts such as `your-domain.atlassian.net` or `ALGOLIA_APPLICATION_ID.algolia.net` became a required field, and every Azure API now asks for a token.

What was checked and what was not: every spec was parsed and imported, every endpoint gets a handler, and the offline tests build signed requests for each cloud. The sandbox cannot reach these providers, so no live call with real credentials was made here; these APIs are all bring-your-own-key and the first real calls happen after deploy (`/admin` shows upstream errors per source). Open-data portals were each answered by their search API from an external checker on 2026-10-28; most other CKAN, Dataverse, Socrata and Opendatasoft portals could not be checked (robots.txt blocks automated checks) and were left out.
