# Where Apizie's APIs come from (October 2026)

| Source | APIs | Endpoints | Key needed |
|---|---|---|---|
| OpenAPI directory: APIs.guru (openapi-directory 1.3.17) plus official provider specs from GitHub | 1,454 | about 45,500 operations | depends on the provider; keyless ones are live, the rest are bring-your-own-key |
| Native live modules (`src/scrapers/live/*.js`) | 245 | 651 | none (a few optional env keys) |
| Of those: keyless public APIs (`public-apis.js`, `public-apis-2.js`) | 153 | 318 | none |
| Catalog total (`app.catalog.totals()`) | 1,901 | 47,141 | 629 live APIs / 9,898 live endpoints |

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

- **AWS** (SigV4 request signing is not supported by the connector).
- **Azure Resource Manager and Azure Stack admin** (control-plane management, not data). Microsoft Graph and Cognitive Services stay in.
- **Mailchimp Transactional** and other specs whose auth cannot be expressed as a header key.
- Anything that needs scraping around bot protection, or a private or unofficial API.

## How it is checked

`test/public-apis.test.js` runs every keyless endpoint offline with its documented example parameters and a mock `fetch`: unique keys and slugs, a source URL, required fields with examples, no em dashes, and exactly one valid public `https` call without `undefined` or `NaN`. The build sandbox cannot reach most upstream hosts, so live responses were not checked here; the first real calls happen after deploy, and `/admin` shows upstream errors per endpoint.

To refresh the directory: `node scripts/import-openapi.js <openapi-directory>/APIs [extra spec dirs...]`.
