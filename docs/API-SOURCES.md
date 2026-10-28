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

## Iteration 9 (28 October 2026): global news and popular tools

- **104 international news sources** from publishers' own RSS/Atom feeds (`src/scrapers/live/news-global.js`), many with sections: NPR, New York Times, Fox News, CBS, Sky News, WSJ, The Economist, Bloomberg, Deutsche Welle, France 24, Euronews, Al Jazeera, SCMP, Straits Times, The Hindu, ABC Australia, TechCrunch, Engadget, MIT Technology Review, Nature, NASA, WHO, BBC Sport, IGN, Decrypt and more.
  - 67 feeds were fetched successfully from an external checker on 2026-10-28. 37 are official feeds that checker could not reach (robots.txt or network block); they carry `verified: false` in the source file. Extra sections follow each publisher's documented URL pattern and were not all checked one by one. Source health in `/admin` shows real error rates once traffic flows.
- **RSS & Atom Reader** (`web-tools:rss-reader`): `read` any public feed as JSON, `discover` the feeds a website advertises, `merge` up to 10 feeds into one timeline. Caller URLs are SSRF-checked on every redirect hop.
- **24 popular keyless APIs** (`src/scrapers/live/public-apis-3.js`): OpenStreetMap Overpass (places nearby with phone and website), Photon geocoder, Open Topo Data elevation, Postcodes.io, CountriesNow, GDACS disaster alerts, NOAA space weather, USGS volcano alerts, NASA Image Library, ADS-B live flights, TfL status, Blockchain.com ticker, ExchangeRate-API open access, Arbeitnow and Remote OK jobs, Hacker News search, GitHub trending, Iconify, Google Public DNS, is.gd, ZenQuotes, Useless Facts, EmojiHub, OpenLigaDB.
  - Live-checked on 2026-10-28 except Overpass and Photon (checker blocked by robots.txt).
- Left out after checking: CoinCap v2 (shut down), OpenAQ v3 and Google Books (key required), Lingva (unofficial Google Translate front end), OSRM demo server and Remotive (usage terms forbid this kind of reuse), ipapi.co (not for production), CNN (feeds stale), and feeds that returned errors (Washington Post, Japan Times, Bangkok Post, CBC, Mail & Guardian, Rappler, Newsweek, UN News, ESPN, Phys.org).
