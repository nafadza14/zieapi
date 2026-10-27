// Keyless public APIs from the open web, added in iteration 8 (see docs/API-SOURCES.md).
// Each endpoint calls one documented public URL and returns the provider's JSON as `data`,
// so the response matches the provider's own docs. Fair-use limits of each provider apply;
// cache TTLs below keep Apizie well inside them.

import { url, getJson, getText, f, ScraperError } from "../kit.js";

export const enc = encodeURIComponent;
export const lim = (def = 10, max = 100, name = "limit") => f.int(name, { default: def, min: 1, max, description: "Number of results" });

/** One GET endpoint that returns the upstream JSON (or text when `text: true`). */
export const get = (slug, displayName, description, fields, target, opts = {}) => ({
  slug,
  displayName,
  description,
  method: "GET",
  cacheTtl: opts.ttl ?? 300,
  pathTemplate: null,
  bulkEnabled: true,
  fields,
  handler: async (p, ctx) => {
    const u = target(p);
    const raw = opts.text ? await getText(ctx, u) : await getJson(ctx, u, opts.headers ? { headers: opts.headers } : {});
    return opts.map ? opts.map(raw, p) : raw;
  },
});

export const api = (category, slug, displayName, description, sourceUrl, tags, endpoints) => ({ category, slug, displayName, description, sourceUrl, tags, endpoints });
export const date = (name, opts = {}) => f.str(name, { pattern: "^\\d{4}-\\d{2}-\\d{2}$", ...opts });

/* ────────────────────────────── weather, earth, places ────────────────────────────── */

const openMeteo = api("places", "open-meteo", "Open-Meteo", "Weather forecasts, historical weather, air quality, marine data and geocoding for any place on Earth.", "https://open-meteo.com", ["weather", "forecast", "climate", "air-quality", "geocoding"], [
  get("forecast", "Forecast", "Current conditions plus hourly and daily forecast for a coordinate.", [
    f.req("latitude", { type: "number", example: 48.8566 }), f.req("longitude", { type: "number", example: 2.3522 }),
    f.str("current", { default: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m", description: "Comma-separated current variables" }),
    f.str("hourly", { description: "Comma-separated hourly variables, e.g. temperature_2m,precipitation_probability" }),
    f.str("daily", { default: "temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset", description: "Comma-separated daily variables" }),
    f.int("forecastDays", { default: 7, min: 1, max: 16 }), f.str("timezone", { default: "auto" }),
    f.enm("temperatureUnit", ["celsius", "fahrenheit"], { default: "celsius" }),
  ], (p) => url("https://api.open-meteo.com/v1/forecast", { latitude: p.latitude, longitude: p.longitude, current: p.current, hourly: p.hourly, daily: p.daily, forecast_days: p.forecastDays, timezone: p.timezone, temperature_unit: p.temperatureUnit }), { ttl: 900 }),
  get("history", "Historical weather", "Daily weather history from the ERA5 archive (1940 to a few days ago).", [
    f.req("latitude", { type: "number", example: 40.71 }), f.req("longitude", { type: "number", example: -74.01 }),
    date("startDate", { required: true, example: "2024-01-01" }), date("endDate", { required: true, example: "2024-01-31" }),
    f.str("daily", { default: "temperature_2m_max,temperature_2m_min,precipitation_sum" }), f.str("timezone", { default: "auto" }),
  ], (p) => url("https://archive-api.open-meteo.com/v1/archive", { latitude: p.latitude, longitude: p.longitude, start_date: p.startDate, end_date: p.endDate, daily: p.daily, timezone: p.timezone }), { ttl: 86400 }),
  get("air-quality", "Air quality", "Current and hourly air quality (PM2.5, PM10, ozone, US and European AQI).", [
    f.req("latitude", { type: "number", example: 28.61 }), f.req("longitude", { type: "number", example: 77.21 }),
    f.str("current", { default: "us_aqi,european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide" }), f.str("hourly"), f.str("timezone", { default: "auto" }),
  ], (p) => url("https://air-quality-api.open-meteo.com/v1/air-quality", { latitude: p.latitude, longitude: p.longitude, current: p.current, hourly: p.hourly, timezone: p.timezone }), { ttl: 1800 }),
  get("marine", "Marine forecast", "Wave height, direction and period for ocean coordinates.", [
    f.req("latitude", { type: "number", example: -8.72 }), f.req("longitude", { type: "number", example: 115.17 }),
    f.str("current", { default: "wave_height,wave_direction,wave_period" }), f.str("daily", { default: "wave_height_max" }), f.str("timezone", { default: "auto" }),
  ], (p) => url("https://marine-api.open-meteo.com/v1/marine", { latitude: p.latitude, longitude: p.longitude, current: p.current, daily: p.daily, timezone: p.timezone }), { ttl: 1800 }),
  get("geocode", "Geocoding", "Find coordinates, country and timezone for a place name.", [f.req("name", { example: "Lisbon" }), lim(5, 100, "count"), f.str("language", { default: "en" })],
    (p) => url("https://geocoding-api.open-meteo.com/v1/search", { name: p.name, count: p.count, language: p.language, format: "json" }), { ttl: 86400 }),
]);

const nominatim = api("places", "nominatim", "OpenStreetMap Nominatim", "Geocoding and reverse geocoding from OpenStreetMap data. Respect the 1 request per second policy; results are cached for a day.", "https://nominatim.org", ["openstreetmap", "osm", "geocoding", "address", "maps"], [
  get("search", "Search", "Turn an address or place name into coordinates.", [f.req("query", { example: "Brandenburger Tor, Berlin" }), lim(5, 40), f.str("countryCodes", { description: "Comma-separated ISO 3166-1 alpha-2 codes" })],
    (p) => url("https://nominatim.openstreetmap.org/search", { q: p.query, format: "jsonv2", limit: p.limit, countrycodes: p.countryCodes, addressdetails: 1 }), { ttl: 86400 }),
  get("reverse", "Reverse", "Turn coordinates into an address.", [f.req("lat", { type: "number", example: 51.5007 }), f.req("lon", { type: "number", example: -0.1246 }), f.int("zoom", { default: 18, min: 3, max: 18 })],
    (p) => url("https://nominatim.openstreetmap.org/reverse", { lat: p.lat, lon: p.lon, zoom: p.zoom, format: "jsonv2", addressdetails: 1 }), { ttl: 86400 }),
]);

const zippopotam = api("places", "zippopotam", "Zippopotam.us", "Postal code lookup for 60+ countries: place names, state and coordinates.", "https://www.zippopotam.us", ["postal-code", "zip", "address"], [
  get("lookup", "Postal code", "Places for one postal code.", [f.req("country", { example: "us", description: "ISO 3166-1 alpha-2" }), f.req("postalCode", { example: "90210" })],
    (p) => `https://api.zippopotam.us/${enc(p.country.toLowerCase())}/${enc(p.postalCode)}`, { ttl: 604800 }),
]);

const restCountries = api("places", "rest-countries", "REST Countries", "Facts about every country: names, capitals, currencies, languages, population, flags and borders.", "https://restcountries.com", ["countries", "flags", "currency", "population"], [
  get("by-name", "By name", "Countries matching a name.", [f.req("name", { example: "japan" }), f.str("fields", { description: "Comma-separated fields to return" })],
    (p) => url(`https://restcountries.com/v3.1/name/${enc(p.name)}`, { fields: p.fields }), { ttl: 86400 }),
  get("by-code", "By code", "Country by ISO 3166 alpha-2 or alpha-3 code.", [f.req("code", { example: "BR" })], (p) => `https://restcountries.com/v3.1/alpha/${enc(p.code)}`, { ttl: 86400 }),
  get("by-region", "By region", "Countries in a region.", [f.enm("region", ["africa", "americas", "asia", "europe", "oceania"], { required: true, example: "europe" }), f.str("fields", { default: "name,cca2,capital,population,flags" })],
    (p) => url(`https://restcountries.com/v3.1/region/${enc(p.region)}`, { fields: p.fields }), { ttl: 86400 }),
  get("by-currency", "By currency", "Countries using a currency.", [f.req("currency", { example: "eur" })], (p) => `https://restcountries.com/v3.1/currency/${enc(p.currency)}`, { ttl: 86400 }),
]);

const sunrise = api("places", "sunrise-sunset", "Sunrise Sunset", "Sunrise, sunset, solar noon and twilight times for a coordinate and date.", "https://sunrise-sunset.org/api", ["sun", "astronomy", "daylight"], [
  get("times", "Sun times", "Times in UTC (ISO 8601).", [f.req("lat", { type: "number", example: 35.6762 }), f.req("lng", { type: "number", example: 139.6503 }), date("date", { description: "YYYY-MM-DD, default today" })],
    (p) => url("https://api.sunrise-sunset.org/json", { lat: p.lat, lng: p.lng, date: p.date, formatted: 0 }), { ttl: 3600 }),
]);

const nws = api("places", "us-weather-service", "US National Weather Service", "Official US forecasts, alerts and observations from weather.gov.", "https://www.weather.gov/documentation/services-web-api", ["weather", "usa", "alerts", "noaa"], [
  get("point", "Point metadata", "Forecast office and forecast URLs for a US coordinate.", [f.req("lat", { type: "number", example: 39.7456 }), f.req("lon", { type: "number", example: -97.0892 })],
    (p) => `https://api.weather.gov/points/${Number(p.lat).toFixed(4)},${Number(p.lon).toFixed(4)}`, { ttl: 86400, headers: { accept: "application/geo+json" } }),
  get("forecast", "Forecast", "7-day forecast for a forecast office grid point.", [f.req("office", { example: "TOP" }), f.req("gridX", { type: "integer", example: 31 }), f.req("gridY", { type: "integer", example: 80 })],
    (p) => `https://api.weather.gov/gridpoints/${enc(p.office)}/${p.gridX},${p.gridY}/forecast`, { ttl: 1800, headers: { accept: "application/geo+json" } }),
  get("alerts", "Active alerts", "Active watches, warnings and advisories.", [f.str("area", { example: "CA", description: "US state or marine area code" }), f.enm("severity", ["Extreme", "Severe", "Moderate", "Minor", "Unknown"])],
    (p) => url("https://api.weather.gov/alerts/active", { area: p.area, severity: p.severity }), { ttl: 300, headers: { accept: "application/geo+json" } }),
]);

const usgs = api("places", "usgs-earthquakes", "USGS Earthquakes", "Real-time and historical earthquakes worldwide from the US Geological Survey.", "https://earthquake.usgs.gov/fdsnws/event/1/", ["earthquake", "seismic", "disaster", "geojson"], [
  get("feed", "Live feed", "Summary feed as GeoJSON.", [f.enm("magnitude", ["significant", "4.5", "2.5", "1.0", "all"], { default: "4.5" }), f.enm("period", ["hour", "day", "week", "month"], { default: "day" })],
    (p) => `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${p.magnitude}_${p.period}.geojson`, { ttl: 120 }),
  get("search", "Search", "Earthquakes by time window, magnitude and area.", [
    date("start", { example: "2024-01-01" }), date("end"), f.num("minMagnitude", { default: 4 }), f.num("latitude"), f.num("longitude"), f.num("maxRadiusKm", { max: 20001.6 }), lim(50, 2000),
    f.enm("orderBy", ["time", "time-asc", "magnitude", "magnitude-asc"], { default: "time" }),
  ], (p) => url("https://earthquake.usgs.gov/fdsnws/event/1/query", { format: "geojson", starttime: p.start, endtime: p.end, minmagnitude: p.minMagnitude, latitude: p.latitude, longitude: p.longitude, maxradiuskm: p.maxRadiusKm, limit: p.limit, orderby: p.orderBy }), { ttl: 300 }),
]);

const opensky = api("transport", "opensky", "OpenSky Network", "Live aircraft positions from the OpenSky Network (anonymous access, 10 second resolution).", "https://openskynetwork.github.io/opensky-api/", ["flights", "aircraft", "ads-b", "aviation"], [
  get("states", "Aircraft in an area", "State vectors inside a bounding box.", [f.req("lamin", { type: "number", example: 45.8 }), f.req("lomin", { type: "number", example: 5.9 }), f.req("lamax", { type: "number", example: 47.8 }), f.req("lomax", { type: "number", example: 10.5 })],
    (p) => url("https://opensky-network.org/api/states/all", { lamin: p.lamin, lomin: p.lomin, lamax: p.lamax, lomax: p.lomax }), { ttl: 15 }),
]);

const aviationWeather = api("transport", "aviation-weather", "Aviation Weather Center", "METAR observations and TAF forecasts for airports worldwide (NOAA).", "https://aviationweather.gov/data/api/", ["metar", "taf", "aviation", "weather", "airport"], [
  get("metar", "METAR", "Latest observations for ICAO station ids.", [f.req("ids", { example: "KJFK,EGLL" }), f.int("hours", { default: 2, min: 1, max: 72 })],
    (p) => url("https://aviationweather.gov/api/data/metar", { ids: p.ids, hours: p.hours, format: "json" }), { ttl: 300 }),
  get("taf", "TAF", "Terminal aerodrome forecasts.", [f.req("ids", { example: "KJFK" })], (p) => url("https://aviationweather.gov/api/data/taf", { ids: p.ids, format: "json" }), { ttl: 600 }),
]);

const citybikes = api("transport", "citybikes", "CityBikes", "Bike-share networks and live station availability in 600+ cities.", "https://api.citybik.es", ["bike-share", "mobility", "transport"], [
  get("networks", "Networks", "Every bike-share network with its city and id.", [], () => "https://api.citybik.es/v2/networks?fields=id,name,location", { ttl: 86400 }),
  get("network", "Stations", "Stations with free bikes and empty slots.", [f.req("id", { example: "velib" })], (p) => `https://api.citybik.es/v2/networks/${enc(p.id)}`, { ttl: 60 }),
]);

const carbonUk = api("open-data", "uk-carbon-intensity", "UK Carbon Intensity", "Carbon intensity and generation mix of the Great Britain electricity grid (National Energy System Operator).", "https://carbonintensity.org.uk", ["energy", "carbon", "electricity", "uk"], [
  get("now", "Current intensity", "Carbon intensity for the current half hour.", [], () => "https://api.carbonintensity.org.uk/intensity", { ttl: 900 }),
  get("generation", "Generation mix", "Current fuel mix in percent.", [], () => "https://api.carbonintensity.org.uk/generation", { ttl: 900 }),
  get("regional", "Regional", "Intensity for each GB region.", [], () => "https://api.carbonintensity.org.uk/regional", { ttl: 900 }),
]);

const ukFloods = api("open-data", "uk-flood-monitoring", "UK Flood Monitoring", "Flood warnings and river level stations in England (Environment Agency).", "https://environment.data.gov.uk/flood-monitoring/doc/reference", ["flood", "rivers", "uk", "environment"], [
  get("warnings", "Flood warnings", "Current flood alerts and warnings.", [f.int("minSeverity", { min: 1, max: 4, description: "1 = severe, 4 = no longer in force" })],
    (p) => url("https://environment.data.gov.uk/flood-monitoring/id/floods", { "min-severity": p.minSeverity }), { ttl: 300 }),
  get("stations", "Stations", "Monitoring stations near a coordinate.", [f.req("lat", { type: "number", example: 51.5 }), f.req("long", { type: "number", example: -0.12 }), f.num("dist", { default: 10, description: "Radius in km" })],
    (p) => url("https://environment.data.gov.uk/flood-monitoring/id/stations", { lat: p.lat, long: p.long, dist: p.dist }), { ttl: 3600 }),
]);

const noaaTides = api("open-data", "noaa-tides", "NOAA Tides & Currents", "Water levels, tide predictions and meteorological data from US coastal stations.", "https://api.tidesandcurrents.noaa.gov/api/prod/", ["tides", "ocean", "noaa", "water-level"], [
  get("data", "Station data", "Latest or ranged data for one station.", [
    f.req("station", { example: "9414290" }), f.enm("product", ["water_level", "predictions", "air_temperature", "water_temperature", "wind", "air_pressure"], { default: "water_level" }),
    f.str("date", { default: "latest", description: "latest, today, recent, or use beginDate/endDate" }), f.str("beginDate", { description: "yyyyMMdd" }), f.str("endDate", { description: "yyyyMMdd" }),
    f.enm("units", ["metric", "english"], { default: "metric" }),
  ], (p) => url("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", { station: p.station, product: p.product, date: p.beginDate ? undefined : p.date, begin_date: p.beginDate, end_date: p.endDate, datum: "MLLW", units: p.units, time_zone: "gmt", format: "json", application: "apizie" }), { ttl: 300 }),
]);

const nager = api("places", "public-holidays", "Public Holidays (Nager.Date)", "Public holidays for 100+ countries, long weekends and the next holidays worldwide.", "https://date.nager.at", ["holidays", "calendar", "countries"], [
  get("by-country", "Holidays by country", "All public holidays in a year.", [f.int("year", { required: true, example: 2026 }), f.req("countryCode", { example: "DE" })],
    (p) => `https://date.nager.at/api/v3/PublicHolidays/${p.year}/${enc(p.countryCode.toUpperCase())}`, { ttl: 86400 }),
  get("next", "Next holidays", "Upcoming holidays in one country.", [f.req("countryCode", { example: "US" })], (p) => `https://date.nager.at/api/v3/NextPublicHolidays/${enc(p.countryCode.toUpperCase())}`, { ttl: 3600 }),
  get("worldwide", "Next 7 days worldwide", "Holidays in the next seven days anywhere.", [], () => "https://date.nager.at/api/v3/NextPublicHolidaysWorldwide", { ttl: 3600 }),
  get("long-weekends", "Long weekends", "Long weekends in a year.", [f.int("year", { required: true, example: 2026 }), f.req("countryCode", { example: "GB" })],
    (p) => `https://date.nager.at/api/v3/LongWeekend/${p.year}/${enc(p.countryCode.toUpperCase())}`, { ttl: 86400 }),
  get("countries", "Supported countries", "Countries with holiday data.", [], () => "https://date.nager.at/api/v3/AvailableCountries", { ttl: 604800 }),
]);

const issNow = api("open-data", "iss-location", "Where the ISS at?", "Live position, altitude and velocity of the International Space Station.", "https://wheretheiss.at/w/developer", ["iss", "space", "satellite"], [
  get("position", "Current position", "ISS (NORAD 25544) position now.", [], () => "https://api.wheretheiss.at/v1/satellites/25544", { ttl: 5 }),
]);

/* ────────────────────────────── finance and crypto ────────────────────────────── */

const frankfurter = api("finance", "frankfurter", "Frankfurter", "Foreign exchange reference rates published by the European Central Bank, from 1999 to today.", "https://frankfurter.dev", ["currency", "exchange-rates", "forex", "ecb"], [
  get("latest", "Latest rates", "Latest working-day rates.", [f.str("base", { default: "EUR" }), f.str("symbols", { example: "USD,GBP,JPY" }), f.num("amount", { default: 1 })],
    (p) => url("https://api.frankfurter.dev/v1/latest", { base: p.base, symbols: p.symbols, amount: p.amount }), { ttl: 3600 }),
  get("historical", "Rates on a date", "Rates for one past date.", [date("date", { required: true, example: "2020-03-16" }), f.str("base", { default: "EUR" }), f.str("symbols")],
    (p) => url(`https://api.frankfurter.dev/v1/${p.date}`, { base: p.base, symbols: p.symbols }), { ttl: 86400 }),
  get("timeseries", "Time series", "Daily rates between two dates.", [date("start", { required: true, example: "2024-01-01" }), date("end", { example: "2024-01-31" }), f.str("base", { default: "EUR" }), f.str("symbols", { example: "USD" })],
    (p) => url(`https://api.frankfurter.dev/v1/${p.start}..${p.end ?? ""}`, { base: p.base, symbols: p.symbols }), { ttl: 86400 }),
  get("currencies", "Currencies", "Supported currency codes and names.", [], () => "https://api.frankfurter.dev/v1/currencies", { ttl: 604800 }),
]);

const coinpaprika = api("finance", "coinpaprika", "CoinPaprika", "Prices, market caps and metadata for 2,500+ crypto assets.", "https://api.coinpaprika.com", ["crypto", "prices", "market-cap"], [
  get("global", "Global market", "Total market cap, volume and Bitcoin dominance.", [], () => "https://api.coinpaprika.com/v1/global", { ttl: 300 }),
  get("ticker", "Ticker", "Price and changes for one coin.", [f.req("coinId", { example: "btc-bitcoin" }), f.str("quotes", { default: "USD" })],
    (p) => url(`https://api.coinpaprika.com/v1/tickers/${enc(p.coinId)}`, { quotes: p.quotes }), { ttl: 120 }),
  get("coin", "Coin details", "Description, team, links and tags.", [f.req("coinId", { example: "eth-ethereum" })], (p) => `https://api.coinpaprika.com/v1/coins/${enc(p.coinId)}`, { ttl: 3600 }),
  get("search", "Search", "Find coins, exchanges and people by name.", [f.req("query", { example: "solana" }), lim(6, 250)],
    (p) => url("https://api.coinpaprika.com/v1/search", { q: p.query, limit: p.limit, c: "currencies,exchanges" }), { ttl: 3600 }),
  get("ohlc-today", "OHLC today", "Today's open, high, low and close.", [f.req("coinId", { example: "btc-bitcoin" })], (p) => `https://api.coinpaprika.com/v1/coins/${enc(p.coinId)}/ohlcv/today`, { ttl: 300 }),
]);

const kraken = api("finance", "kraken", "Kraken", "Public market data from the Kraken exchange: tickers, order books and OHLC candles.", "https://docs.kraken.com/api/", ["crypto", "exchange", "trading", "bitcoin"], [
  get("ticker", "Ticker", "Last trade, bid, ask and 24h volume.", [f.req("pair", { example: "XBTUSD", description: "One or more pairs, comma-separated" })], (p) => url("https://api.kraken.com/0/public/Ticker", { pair: p.pair }), { ttl: 15 }),
  get("ohlc", "OHLC", "Candles for a pair.", [f.req("pair", { example: "ETHUSD" }), f.enm("interval", ["1", "5", "15", "30", "60", "240", "1440", "10080", "21600"], { default: "60", description: "Minutes" })],
    (p) => url("https://api.kraken.com/0/public/OHLC", { pair: p.pair, interval: p.interval }), { ttl: 60 }),
  get("depth", "Order book", "Bids and asks.", [f.req("pair", { example: "XBTUSD" }), lim(25, 500, "count")], (p) => url("https://api.kraken.com/0/public/Depth", { pair: p.pair, count: p.count }), { ttl: 5 }),
  get("assets", "Assets", "Tradable assets.", [], () => "https://api.kraken.com/0/public/Assets", { ttl: 86400 }),
]);

const coinbase = api("finance", "coinbase", "Coinbase", "Spot prices, exchange rates and public market data from Coinbase.", "https://docs.cdp.coinbase.com", ["crypto", "exchange", "bitcoin", "prices"], [
  get("spot", "Spot price", "Spot price for a currency pair.", [f.req("pair", { example: "BTC-USD" })], (p) => `https://api.coinbase.com/v2/prices/${enc(p.pair)}/spot`, { ttl: 30 }),
  get("exchange-rates", "Exchange rates", "Rates from one currency to every other.", [f.str("currency", { default: "USD" })], (p) => url("https://api.coinbase.com/v2/exchange-rates", { currency: p.currency }), { ttl: 60 }),
  get("product-ticker", "Product ticker", "Last trade, bid and ask on Coinbase Exchange.", [f.req("product", { example: "ETH-USD" })], (p) => `https://api.exchange.coinbase.com/products/${enc(p.product)}/ticker`, { ttl: 10 }),
  get("product-stats", "24h stats", "Open, high, low, volume over 24 hours.", [f.req("product", { example: "BTC-USD" })], (p) => `https://api.exchange.coinbase.com/products/${enc(p.product)}/stats`, { ttl: 30 }),
  get("candles", "Candles", "OHLCV candles.", [f.req("product", { example: "BTC-USD" }), f.enm("granularity", ["60", "300", "900", "3600", "21600", "86400"], { default: "3600", description: "Seconds" })],
    (p) => url(`https://api.exchange.coinbase.com/products/${enc(p.product)}/candles`, { granularity: p.granularity }), { ttl: 60 }),
]);

const bitstamp = api("finance", "bitstamp", "Bitstamp", "Public ticker and order book data from Bitstamp.", "https://www.bitstamp.net/api/", ["crypto", "exchange", "bitcoin"], [
  get("ticker", "Ticker", "Last price, high, low, volume, VWAP.", [f.req("pair", { example: "btcusd" })], (p) => `https://www.bitstamp.net/api/v2/ticker/${enc(p.pair.toLowerCase())}/`, { ttl: 15 }),
  get("order-book", "Order book", "Bids and asks.", [f.req("pair", { example: "ethusd" })], (p) => `https://www.bitstamp.net/api/v2/order_book/${enc(p.pair.toLowerCase())}/`, { ttl: 5 }),
]);

const kucoin = api("finance", "kucoin", "KuCoin", "Public market data from KuCoin spot markets.", "https://www.kucoin.com/docs/", ["crypto", "exchange", "altcoins"], [
  get("ticker", "Ticker", "Best bid, ask and last price.", [f.req("symbol", { example: "BTC-USDT" })], (p) => url("https://api.kucoin.com/api/v1/market/orderbook/level1", { symbol: p.symbol }), { ttl: 10 }),
  get("stats", "24h stats", "24 hour statistics for a symbol.", [f.req("symbol", { example: "ETH-USDT" })], (p) => url("https://api.kucoin.com/api/v1/market/stats", { symbol: p.symbol }), { ttl: 30 }),
  get("all-tickers", "All tickers", "Every market's 24h ticker.", [], () => "https://api.kucoin.com/api/v1/market/allTickers", { ttl: 30 }),
]);

const gate = api("finance", "gate-io", "Gate.io", "Spot tickers and currency pairs from Gate.io.", "https://www.gate.io/docs/developers/apiv4/", ["crypto", "exchange"], [
  get("tickers", "Tickers", "Spot tickers, optionally one pair.", [f.str("pair", { example: "BTC_USDT" })], (p) => url("https://api.gateio.ws/api/v4/spot/tickers", { currency_pair: p.pair }), { ttl: 15 }),
]);

const dexscreener = api("finance", "dexscreener", "DEX Screener", "Decentralized exchange pairs, prices and liquidity across 80+ chains.", "https://docs.dexscreener.com", ["defi", "dex", "crypto", "tokens"], [
  get("search", "Search pairs", "Pairs matching a token name, symbol or address.", [f.req("query", { example: "PEPE/WETH" })], (p) => url("https://api.dexscreener.com/latest/dex/search", { q: p.query }), { ttl: 60 }),
  get("token", "Token pairs", "Pairs for one or more token addresses.", [f.req("addresses", { example: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" })], (p) => `https://api.dexscreener.com/latest/dex/tokens/${enc(p.addresses)}`, { ttl: 60 }),
  get("pair", "Pair", "One pair on one chain.", [f.req("chain", { example: "ethereum" }), f.req("pairAddress", { example: "0xa43fe16908251ee70ef74718545e4fe6c5ccec9f" })],
    (p) => `https://api.dexscreener.com/latest/dex/pairs/${enc(p.chain)}/${enc(p.pairAddress)}`, { ttl: 30 }),
]);

const dbnomics = api("finance", "dbnomics", "DBnomics", "One API for macroeconomic data from 80+ providers: IMF, OECD, Eurostat, ECB, World Bank, BIS and national statistics offices.", "https://db.nomics.world", ["economics", "macro", "imf", "oecd", "eurostat", "statistics"], [
  get("search", "Search datasets", "Find datasets by keyword.", [f.req("query", { example: "inflation" }), lim(10, 100)], (p) => url("https://api.db.nomics.world/v22/search", { q: p.query, limit: p.limit }), { ttl: 3600 }),
  get("series", "Series", "Observations for one series (provider/dataset/series code).", [f.req("provider", { example: "IMF" }), f.req("dataset", { example: "WEO:2024-10" }), f.req("series", { example: "USA.NGDP_RPCH.pcent_change" })],
    (p) => url(`https://api.db.nomics.world/v22/series/${enc(p.provider)}/${enc(p.dataset)}/${enc(p.series)}`, { observations: 1 }), { ttl: 21600 }),
  get("providers", "Providers", "Every data provider in DBnomics.", [], () => "https://api.db.nomics.world/v22/providers", { ttl: 86400 }),
]);

/* ────────────────────────────── research, books, knowledge ────────────────────────────── */

const openalex = api("research", "openalex", "OpenAlex", "An open index of 250M+ scholarly works, authors, institutions and topics.", "https://openalex.org", ["scholarly", "papers", "citations", "research"], [
  get("works", "Search works", "Papers, books and datasets.", [f.req("query", { example: "retrieval augmented generation" }), lim(10, 200, "perPage"), f.int("page", { default: 1, min: 1 }), f.str("filter", { example: "publication_year:2024,is_oa:true" }), f.str("sort", { example: "cited_by_count:desc" })],
    (p) => url("https://api.openalex.org/works", { search: p.query, "per-page": p.perPage, page: p.page, filter: p.filter, sort: p.sort }), { ttl: 3600 }),
  get("work", "Work", "One work by OpenAlex id or DOI.", [f.req("id", { example: "doi:10.1038/nature14539" })], (p) => `https://api.openalex.org/works/${enc(p.id)}`, { ttl: 86400 }),
  get("authors", "Search authors", "Authors with works and citation counts.", [f.req("query", { example: "Yoshua Bengio" }), lim(10, 200, "perPage")], (p) => url("https://api.openalex.org/authors", { search: p.query, "per-page": p.perPage }), { ttl: 3600 }),
  get("institutions", "Search institutions", "Universities and research organizations.", [f.req("query", { example: "MIT" }), lim(10, 200, "perPage")], (p) => url("https://api.openalex.org/institutions", { search: p.query, "per-page": p.perPage }), { ttl: 86400 }),
  get("topics", "Search topics", "Research topics with work counts.", [f.req("query", { example: "climate change" }), lim(10, 200, "perPage")], (p) => url("https://api.openalex.org/topics", { search: p.query, "per-page": p.perPage }), { ttl: 86400 }),
]);

const crossref = api("research", "crossref", "Crossref", "Metadata for 160M+ DOIs: journal articles, books, conference papers and their references.", "https://www.crossref.org/documentation/retrieve-metadata/rest-api/", ["doi", "papers", "citations", "journals"], [
  get("works", "Search works", "Bibliographic search.", [f.req("query", { example: "attention is all you need" }), lim(10, 1000, "rows"), f.str("filter", { example: "from-pub-date:2023-01-01,type:journal-article" })],
    (p) => url("https://api.crossref.org/works", { query: p.query, rows: p.rows, filter: p.filter, mailto: "hello@zieads.com" }), { ttl: 3600 }),
  get("doi", "DOI", "Metadata for one DOI.", [f.req("doi", { example: "10.1038/s41586-021-03819-2" })], (p) => `https://api.crossref.org/works/${enc(p.doi)}`, { ttl: 86400 }),
  get("journals", "Journals", "Search journals by title.", [f.req("query", { example: "nature" }), lim(10, 1000, "rows")], (p) => url("https://api.crossref.org/journals", { query: p.query, rows: p.rows }), { ttl: 86400 }),
]);

const semanticScholar = api("research", "semantic-scholar", "Semantic Scholar", "AI-powered academic search from Ai2: papers, authors, citations and TLDR summaries.", "https://api.semanticscholar.org", ["papers", "citations", "ai", "research"], [
  get("search", "Search papers", "Relevance search.", [f.req("query", { example: "large language models" }), lim(10, 100), f.str("fields", { default: "title,year,authors,citationCount,url,tldr" }), f.str("year", { example: "2023-2025" })],
    (p) => url("https://api.semanticscholar.org/graph/v1/paper/search", { query: p.query, limit: p.limit, fields: p.fields, year: p.year }), { ttl: 3600 }),
  get("paper", "Paper", "One paper by S2 id, DOI:, ARXIV: or CorpusId:.", [f.req("id", { example: "ARXIV:1706.03762" }), f.str("fields", { default: "title,year,abstract,authors,citationCount,referenceCount,url,tldr" })],
    (p) => url(`https://api.semanticscholar.org/graph/v1/paper/${enc(p.id)}`, { fields: p.fields }), { ttl: 86400 }),
  get("author-search", "Search authors", "Authors by name.", [f.req("query", { example: "Fei-Fei Li" }), lim(10, 1000), f.str("fields", { default: "name,hIndex,citationCount,paperCount,affiliations" })],
    (p) => url("https://api.semanticscholar.org/graph/v1/author/search", { query: p.query, limit: p.limit, fields: p.fields }), { ttl: 86400 }),
]);

const openLibrary = api("education", "open-library", "Open Library", "Books, editions and authors from the Internet Archive's Open Library.", "https://openlibrary.org/developers/api", ["books", "isbn", "library", "authors"], [
  get("search", "Search books", "Search by title, author or anything.", [f.req("query", { example: "dune frank herbert" }), lim(10, 100), f.int("page", { default: 1, min: 1 }), f.str("fields", { default: "key,title,author_name,first_publish_year,isbn,cover_i,edition_count" })],
    (p) => url("https://openlibrary.org/search.json", { q: p.query, limit: p.limit, page: p.page, fields: p.fields }), { ttl: 3600 }),
  get("isbn", "By ISBN", "Edition for an ISBN-10 or ISBN-13.", [f.req("isbn", { example: "9780441172719" })], (p) => `https://openlibrary.org/isbn/${enc(p.isbn)}.json`, { ttl: 86400 }),
  get("work", "Work", "A work (all editions) by id.", [f.req("id", { example: "OL893415W" })], (p) => `https://openlibrary.org/works/${enc(p.id)}.json`, { ttl: 86400 }),
  get("authors", "Search authors", "Authors by name.", [f.req("query", { example: "ursula le guin" })], (p) => url("https://openlibrary.org/search/authors.json", { q: p.query }), { ttl: 86400 }),
]);

const gutendex = api("education", "gutendex", "Project Gutenberg (Gutendex)", "70,000+ free public-domain ebooks with download links in every format.", "https://gutendex.com", ["books", "ebooks", "public-domain", "literature"], [
  get("search", "Search books", "Search titles and authors.", [f.str("query", { example: "sherlock holmes" }), f.str("languages", { example: "en,fr" }), f.str("topic", { example: "children" }), f.int("page", { default: 1, min: 1 })],
    (p) => url("https://gutendex.com/books/", { search: p.query, languages: p.languages, topic: p.topic, page: p.page }), { ttl: 86400 }),
  get("book", "Book", "One book by Gutenberg id.", [f.req("id", { type: "integer", example: 1342 })], (p) => `https://gutendex.com/books/${p.id}/`, { ttl: 86400 }),
]);

const universities = api("education", "universities", "Universities List", "10,000+ universities worldwide with domains and websites (Hipo).", "https://github.com/Hipo/university-domains-list", ["universities", "education", "domains"], [
  get("search", "Search", "By name and/or country.", [f.str("name", { example: "technology" }), f.str("country", { example: "Germany" })], (p) => url("http://universities.hipolabs.com/search", { name: p.name, country: p.country }), { ttl: 86400 }),
]);

const datamuse = api("education", "datamuse", "Datamuse", "Word-finding engine: words that mean, sound like, rhyme with or are spelled like a word.", "https://www.datamuse.com/api/", ["words", "rhymes", "synonyms", "language"], [
  get("words", "Find words", "Combine constraints such as meaning, sound and spelling.", [f.str("meansLike", { example: "ringing in the ears" }), f.str("soundsLike"), f.str("spelledLike", { example: "t??k" }), f.str("rhymesWith"), f.str("topics"), lim(20, 1000, "max")],
    (p) => url("https://api.datamuse.com/words", { ml: p.meansLike, sl: p.soundsLike, sp: p.spelledLike, rel_rhy: p.rhymesWith, topics: p.topics, max: p.max }), { ttl: 86400 }),
  get("suggest", "Autocomplete", "Word suggestions for a prefix.", [f.req("prefix", { example: "rawr" }), lim(10, 1000, "max")], (p) => url("https://api.datamuse.com/sug", { s: p.prefix, max: p.max }), { ttl: 86400 }),
]);

const dictionary = api("education", "free-dictionary", "Free Dictionary", "Definitions, phonetics, audio and examples (Wiktionary data).", "https://dictionaryapi.dev", ["dictionary", "definitions", "english", "words"], [
  get("define", "Define", "Entries for a word.", [f.req("word", { example: "serendipity" }), f.str("lang", { default: "en" })], (p) => `https://api.dictionaryapi.dev/api/v2/entries/${enc(p.lang)}/${enc(p.word)}`, { ttl: 604800 }),
]);

const wikidata = api("search-tools", "wikidata", "Wikidata", "The free knowledge graph behind Wikipedia: entities, properties and SPARQL queries.", "https://www.wikidata.org/wiki/Wikidata:Data_access", ["knowledge-graph", "sparql", "wikipedia", "entities"], [
  get("search", "Search entities", "Find items and properties by label.", [f.req("query", { example: "Douglas Adams" }), f.str("language", { default: "en" }), lim(7, 50)],
    (p) => url("https://www.wikidata.org/w/api.php", { action: "wbsearchentities", search: p.query, language: p.language, limit: p.limit, format: "json" }), { ttl: 86400 }),
  get("entity", "Entity", "All statements for one entity id.", [f.req("id", { example: "Q42" })], (p) => `https://www.wikidata.org/wiki/Special:EntityData/${enc(p.id)}.json`, { ttl: 86400 }),
  get("sparql", "SPARQL", "Run a read-only SPARQL query.", [f.req("query", { example: "SELECT ?item WHERE { ?item wdt:P31 wd:Q146 } LIMIT 5" })],
    (p) => url("https://query.wikidata.org/sparql", { query: p.query, format: "json" }), { ttl: 3600, headers: { accept: "application/sparql-results+json" } }),
]);

const wikiPageviews = api("search-tools", "wikimedia-pageviews", "Wikimedia Pageviews", "Daily pageviews for any Wikipedia article and the most-read articles per day.", "https://wikimedia.org/api/rest_v1/", ["wikipedia", "trends", "pageviews", "analytics"], [
  get("article", "Article views", "Daily views between two dates.", [f.str("project", { default: "en.wikipedia" }), f.req("article", { example: "Albert_Einstein" }), f.req("start", { example: "20260101" }), f.req("end", { example: "20260131" })],
    (p) => `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${enc(p.project)}/all-access/all-agents/${enc(p.article)}/daily/${enc(p.start)}/${enc(p.end)}`, { ttl: 21600 }),
  get("top", "Most read", "Top articles on one day.", [f.str("project", { default: "en.wikipedia" }), f.req("year", { example: "2026" }), f.req("month", { example: "01" }), f.req("day", { example: "15" })],
    (p) => `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${enc(p.project)}/all-access/${enc(p.year)}/${enc(p.month)}/${enc(p.day)}`, { ttl: 86400 }),
]);

/* ────────────────────────────── science, nature, health ────────────────────────────── */

const gbif = api("research", "gbif", "GBIF", "Global Biodiversity Information Facility: 2.7 billion species occurrence records and the backbone taxonomy.", "https://www.gbif.org/developer/summary", ["biodiversity", "species", "ecology", "taxonomy"], [
  get("species-match", "Match species", "Best match in the GBIF backbone for a name.", [f.req("name", { example: "Puma concolor" })], (p) => url("https://api.gbif.org/v1/species/match", { name: p.name }), { ttl: 86400 }),
  get("species-search", "Search species", "Full-text taxon search.", [f.req("query", { example: "oak" }), lim(20, 1000)], (p) => url("https://api.gbif.org/v1/species/search", { q: p.query, limit: p.limit }), { ttl: 86400 }),
  get("occurrences", "Occurrences", "Observation and specimen records.", [f.str("scientificName", { example: "Panthera tigris" }), f.str("country", { example: "IN" }), f.int("year"), lim(20, 300)],
    (p) => url("https://api.gbif.org/v1/occurrence/search", { scientificName: p.scientificName, country: p.country, year: p.year, limit: p.limit }), { ttl: 3600 }),
]);

const inaturalist = api("research", "inaturalist", "iNaturalist", "Citizen-science observations of plants and animals with photos and identifications.", "https://api.inaturalist.org/v1/docs/", ["nature", "species", "observations", "citizen-science"], [
  get("observations", "Observations", "Recent research-grade observations.", [f.str("taxon", { example: "Monarch butterfly" }), f.int("placeId"), lim(20, 200, "perPage"), f.enm("qualityGrade", ["research", "needs_id", "casual"], { default: "research" })],
    (p) => url("https://api.inaturalist.org/v1/observations", { taxon_name: p.taxon, place_id: p.placeId, per_page: p.perPage, quality_grade: p.qualityGrade, order_by: "observed_on" }), { ttl: 900 }),
  get("taxa", "Taxa", "Search taxa by name.", [f.req("query", { example: "fox" }), lim(10, 200, "perPage")], (p) => url("https://api.inaturalist.org/v1/taxa", { q: p.query, per_page: p.perPage }), { ttl: 86400 }),
]);

const openFda = api("health", "openfda", "openFDA", "US Food and Drug Administration data: drug labels, adverse events and recalls.", "https://open.fda.gov/apis/", ["fda", "drugs", "recalls", "health"], [
  get("drug-labels", "Drug labels", "Structured product labels.", [f.req("search", { example: 'openfda.brand_name:"advil"' }), lim(5, 100)], (p) => url("https://api.fda.gov/drug/label.json", { search: p.search, limit: p.limit }), { ttl: 86400 }),
  get("drug-events", "Adverse events", "FAERS adverse event reports.", [f.req("search", { example: 'patient.drug.medicinalproduct:"aspirin"' }), lim(5, 100), f.str("count", { example: "patient.reaction.reactionmeddrapt.exact" })],
    (p) => url("https://api.fda.gov/drug/event.json", { search: p.search, limit: p.count ? undefined : p.limit, count: p.count }), { ttl: 86400 }),
  get("food-recalls", "Food recalls", "Food enforcement reports.", [f.str("search", { example: 'state:"CA"' }), lim(10, 100)], (p) => url("https://api.fda.gov/food/enforcement.json", { search: p.search, limit: p.limit }), { ttl: 21600 }),
  get("device-recalls", "Device recalls", "Medical device recalls.", [f.str("search"), lim(10, 100)], (p) => url("https://api.fda.gov/device/recall.json", { search: p.search, limit: p.limit }), { ttl: 21600 }),
]);

const rxnorm = api("health", "rxnorm", "RxNorm (NLM)", "Normalized drug names and codes from the US National Library of Medicine.", "https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html", ["drugs", "medications", "rxcui", "health"], [
  get("drugs", "Drugs by name", "Branded and generic products for a name.", [f.req("name", { example: "ibuprofen" })], (p) => url("https://rxnav.nlm.nih.gov/REST/drugs.json", { name: p.name }), { ttl: 86400 }),
  get("approximate", "Fuzzy match", "Closest RxNorm concepts to a misspelled term.", [f.req("term", { example: "amoxicilin" }), lim(5, 50, "maxEntries")], (p) => url("https://rxnav.nlm.nih.gov/REST/approximateTerm.json", { term: p.term, maxEntries: p.maxEntries }), { ttl: 86400 }),
]);

const diseaseSh = api("health", "disease-sh", "disease.sh", "Open disease data: COVID-19 totals by country and history.", "https://disease.sh", ["covid", "epidemiology", "health"], [
  get("covid-global", "COVID-19 global", "Global totals.", [], () => "https://disease.sh/v3/covid-19/all", { ttl: 3600 }),
  get("covid-country", "COVID-19 by country", "Totals for one country.", [f.req("country", { example: "germany" })], (p) => `https://disease.sh/v3/covid-19/countries/${enc(p.country)}`, { ttl: 3600 }),
]);

/* ────────────────────────────── security ────────────────────────────── */

const nvd = api("security", "nvd-cve", "NVD (NIST)", "The US National Vulnerability Database: CVE details, CVSS scores and affected products.", "https://nvd.nist.gov/developers/vulnerabilities", ["cve", "vulnerabilities", "cvss", "security"], [
  get("cve", "CVE", "One CVE by id.", [f.req("id", { example: "CVE-2021-44228" })], (p) => url("https://services.nvd.nist.gov/rest/json/cves/2.0", { cveId: p.id }), { ttl: 21600 }),
  get("search", "Search CVEs", "Keyword search.", [f.req("keyword", { example: "openssl" }), lim(20, 2000, "resultsPerPage")], (p) => url("https://services.nvd.nist.gov/rest/json/cves/2.0", { keywordSearch: p.keyword, resultsPerPage: p.resultsPerPage }), { ttl: 21600 }),
]);

const epss = api("security", "epss", "EPSS (FIRST)", "Exploit Prediction Scoring System: the probability a CVE is exploited in the next 30 days.", "https://www.first.org/epss/api", ["cve", "exploit", "risk", "security"], [
  get("scores", "Scores", "EPSS score and percentile for CVEs.", [f.req("cve", { example: "CVE-2023-4863,CVE-2024-3094" })], (p) => url("https://api.first.org/data/v1/epss", { cve: p.cve }), { ttl: 21600 }),
]);

const cisaKev = api("security", "cisa-kev", "CISA Known Exploited Vulnerabilities", "The US CISA catalog of vulnerabilities exploited in the wild.", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", ["cve", "kev", "exploited", "security"], [
  get("search", "Search catalog", "Filter the catalog by CVE, vendor or product.", [f.str("cve", { example: "CVE-2021-44228" }), f.str("vendor", { example: "Microsoft" }), f.str("product"), lim(50, 2000)],
    () => "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {
      ttl: 21600,
      map: (j, p) => {
        const has = (v, q) => !q || String(v ?? "").toLowerCase().includes(String(q).toLowerCase());
        const items = (j?.vulnerabilities ?? []).filter((v) => has(v.cveID, p.cve) && has(v.vendorProject, p.vendor) && has(v.product, p.product));
        return { catalogVersion: j?.catalogVersion ?? null, dateReleased: j?.dateReleased ?? null, total: items.length, items: items.slice(0, p.limit ?? 50) };
      },
    }),
]);

const internetdb = api("security", "shodan-internetdb", "Shodan InternetDB", "Open ports, hostnames, tags and known CVEs for an IP address (free, no key).", "https://internetdb.shodan.io", ["ip", "ports", "cve", "security"], [
  get("ip", "IP lookup", "What Shodan has seen on an IPv4 address.", [f.req("ip", { example: "8.8.8.8", pattern: "^(\\d{1,3}\\.){3}\\d{1,3}$" })], (p) => `https://internetdb.shodan.io/${p.ip}`, { ttl: 86400 }),
]);

const pwned = api("security", "pwned-passwords", "Pwned Passwords", "k-anonymity range search over 900M+ breached password hashes (Have I Been Pwned). Send only the first 5 SHA-1 characters.", "https://haveibeenpwned.com/API/v3#PwnedPasswords", ["passwords", "breach", "security", "hibp"], [
  get("range", "Hash range", "Hash suffixes and counts for a 5-character SHA-1 prefix.", [f.req("prefix", { example: "21BD1", pattern: "^[0-9A-Fa-f]{5}$" })], (p) => `https://api.pwnedpasswords.com/range/${p.prefix.toUpperCase()}`, {
    ttl: 86400,
    text: true,
    map: (t, p) => {
      const rows = String(t).trim().split(/\r?\n/).map((l) => l.split(":")).filter((r) => r.length === 2).map(([suffix, count]) => ({ suffix, count: Number(count) }));
      return { prefix: p.prefix.toUpperCase(), count: rows.length, items: rows };
    },
  }),
]);

const crtsh = api("security", "crt-sh", "crt.sh", "Certificate Transparency search: every TLS certificate issued for a domain, useful for subdomain discovery.", "https://crt.sh", ["certificates", "tls", "subdomains", "security"], [
  get("search", "Certificates", "Certificates matching a domain (use %.example.com for subdomains).", [f.req("query", { example: "%.example.com" }), lim(100, 1000)], (p) => url("https://crt.sh/", { q: p.query, output: "json" }), {
    ttl: 21600,
    map: (rows, p) => {
      const list = Array.isArray(rows) ? rows : [];
      return { total: list.length, names: [...new Set(list.flatMap((r) => String(r.name_value ?? "").split("\n")))].slice(0, 500), items: list.slice(0, p.limit ?? 100) };
    },
  }),
]);

/* ────────────────────────────── developer ecosystems ────────────────────────────── */

const pypi = api("dev-tools", "pypi", "PyPI", "Python Package Index metadata: versions, releases, dependencies and project links.", "https://warehouse.pypa.io/api-reference/json.html", ["python", "packages", "pip"], [
  get("package", "Package", "Latest metadata and releases.", [f.req("name", { example: "requests" })], (p) => `https://pypi.org/pypi/${enc(p.name)}/json`, { ttl: 3600 }),
  get("release", "Release", "One version's metadata and files.", [f.req("name", { example: "django" }), f.req("version", { example: "5.0" })], (p) => `https://pypi.org/pypi/${enc(p.name)}/${enc(p.version)}/json`, { ttl: 86400 }),
]);

const crates = api("dev-tools", "crates-io", "crates.io", "The Rust package registry: crates, versions and downloads.", "https://crates.io/data-access", ["rust", "cargo", "packages"], [
  get("search", "Search crates", "Search by name or keyword.", [f.req("query", { example: "serde" }), lim(10, 100, "perPage")], (p) => url("https://crates.io/api/v1/crates", { q: p.query, per_page: p.perPage }), { ttl: 3600 }),
  get("crate", "Crate", "One crate with versions.", [f.req("name", { example: "tokio" })], (p) => `https://crates.io/api/v1/crates/${enc(p.name)}`, { ttl: 3600 }),
]);

const rubygems = api("dev-tools", "rubygems", "RubyGems", "Ruby gems: metadata, versions and downloads.", "https://guides.rubygems.org/rubygems-org-api/", ["ruby", "gems", "packages"], [
  get("gem", "Gem", "Metadata for one gem.", [f.req("name", { example: "rails" })], (p) => `https://rubygems.org/api/v1/gems/${enc(p.name)}.json`, { ttl: 3600 }),
  get("search", "Search gems", "Search by name.", [f.req("query", { example: "http client" })], (p) => url("https://rubygems.org/api/v1/search.json", { query: p.query }), { ttl: 3600 }),
  get("versions", "Versions", "Every published version.", [f.req("name", { example: "nokogiri" })], (p) => `https://rubygems.org/api/v1/versions/${enc(p.name)}.json`, { ttl: 3600 }),
]);

const packagist = api("dev-tools", "packagist", "Packagist", "PHP Composer packages: metadata, versions and download stats.", "https://packagist.org/apidoc", ["php", "composer", "packages"], [
  get("search", "Search packages", "Search by name.", [f.req("query", { example: "laravel" }), lim(15, 100, "perPage")], (p) => url("https://packagist.org/search.json", { q: p.query, per_page: p.perPage }), { ttl: 3600 }),
  get("package", "Package", "One package (vendor/name).", [f.req("name", { example: "guzzlehttp/guzzle" })], (p) => `https://packagist.org/packages/${p.name.split("/").map(enc).join("/")}.json`, { ttl: 3600 }),
]);

const nuget = api("dev-tools", "nuget", "NuGet", "The .NET package gallery.", "https://learn.microsoft.com/nuget/api/overview", [".net", "csharp", "packages"], [
  get("search", "Search packages", "Search by name or keyword.", [f.req("query", { example: "json" }), lim(20, 1000, "take"), f.bool("prerelease", { default: false })],
    (p) => url("https://azuresearch-usnc.nuget.org/query", { q: p.query, take: p.take, prerelease: p.prerelease }), { ttl: 3600 }),
]);

const goProxy = api("dev-tools", "go-modules", "Go Modules", "Latest versions and version lists from the Go module proxy (proxy.golang.org).", "https://proxy.golang.org", ["go", "golang", "modules"], [
  get("latest", "Latest version", "Latest version of a module.", [f.req("module", { example: "github.com/gin-gonic/gin" })], (p) => `https://proxy.golang.org/${goPath(p.module)}/@latest`, { ttl: 3600 }),
  get("versions", "Versions", "Every tagged version.", [f.req("module", { example: "golang.org/x/text" })], (p) => `https://proxy.golang.org/${goPath(p.module)}/@v/list`, {
    ttl: 3600,
    text: true,
    map: (t, p) => ({ module: p.module, versions: String(t).split("\n").map((s) => s.trim()).filter(Boolean) }),
  }),
]);
// The proxy escapes capital letters as "!" + lowercase.
function goPath(m) {
  if (!/^[A-Za-z0-9._~\-/]+$/.test(m)) throw new ScraperError("Invalid module path", { status: 400 });
  return m.replace(/[A-Z]/g, (c) => "!" + c.toLowerCase());
}

const maven = api("dev-tools", "maven-central", "Maven Central", "Java and JVM artifacts on Maven Central.", "https://central.sonatype.org/search/rest-api-guide/", ["java", "maven", "jvm", "packages"], [
  get("search", "Search artifacts", "Solr query, e.g. g:com.google.guava or a keyword.", [f.req("query", { example: "g:com.squareup.okhttp3" }), lim(20, 200, "rows")], (p) => url("https://search.maven.org/solrsearch/select", { q: p.query, rows: p.rows, wt: "json" }), { ttl: 3600 }),
]);

const dockerHubPublic = api("dev-tools", "docker-hub-public", "Docker Hub (public)", "Public images on Docker Hub: search, repository details and tags.", "https://docs.docker.com/docker-hub/api/latest/", ["docker", "containers", "images"], [
  get("search", "Search images", "Search public repositories.", [f.req("query", { example: "postgres" }), lim(10, 100, "pageSize")], (p) => url("https://hub.docker.com/v2/search/repositories/", { query: p.query, page_size: p.pageSize }), { ttl: 3600 }),
  get("repository", "Repository", "Pulls, stars and description.", [f.str("namespace", { default: "library" }), f.req("name", { example: "nginx" })], (p) => `https://hub.docker.com/v2/repositories/${enc(p.namespace)}/${enc(p.name)}/`, { ttl: 3600 }),
  get("tags", "Tags", "Image tags with sizes and digests.", [f.str("namespace", { default: "library" }), f.req("name", { example: "node" }), lim(25, 100, "pageSize")],
    (p) => url(`https://hub.docker.com/v2/repositories/${enc(p.namespace)}/${enc(p.name)}/tags`, { page_size: p.pageSize }), { ttl: 3600 }),
]);

const gitlabPublic = api("dev-tools", "gitlab-public", "GitLab.com (public)", "Public projects on GitLab.com.", "https://docs.gitlab.com/ee/api/projects.html", ["gitlab", "git", "open-source"], [
  get("projects", "Search projects", "Public projects by keyword.", [f.req("query", { example: "terraform" }), lim(20, 100, "perPage"), f.enm("orderBy", ["star_count", "last_activity_at", "created_at", "name"], { default: "star_count" })],
    (p) => url("https://gitlab.com/api/v4/projects", { search: p.query, per_page: p.perPage, order_by: p.orderBy, visibility: "public" }), { ttl: 3600 }),
  get("project", "Project", "One project by numeric id or URL-encoded path.", [f.req("id", { example: "gitlab-org/gitlab" })], (p) => `https://gitlab.com/api/v4/projects/${enc(p.id)}`, { ttl: 3600 }),
]);

const endoflife = api("dev-tools", "endoflife", "endoflife.date", "Release dates and end-of-life schedules for 300+ products (Node.js, Python, Ubuntu, Kubernetes...).", "https://endoflife.date/docs/api", ["eol", "lifecycle", "versions", "support"], [
  get("product", "Product cycles", "Every release cycle with support and EOL dates.", [f.req("product", { example: "nodejs" })], (p) => `https://endoflife.date/api/${enc(p.product)}.json`, { ttl: 86400 }),
  get("products", "All products", "Products tracked.", [], () => "https://endoflife.date/api/all.json", { ttl: 86400 }),
]);

const codeforces = api("dev-tools", "codeforces", "Codeforces", "Competitive programming: users, contests and problems.", "https://codeforces.com/apiHelp", ["competitive-programming", "contests", "algorithms"], [
  get("user", "Users", "Rating and rank for handles.", [f.req("handles", { example: "tourist;Petr" })], (p) => url("https://codeforces.com/api/user.info", { handles: p.handles }), { ttl: 3600 }),
  get("contests", "Contests", "Past and upcoming contests.", [], () => "https://codeforces.com/api/contest.list?gym=false", { ttl: 3600 }),
  get("problems", "Problems", "Problemset, optionally by tags.", [f.str("tags", { example: "dp;greedy" })], (p) => url("https://codeforces.com/api/problemset.problems", { tags: p.tags }), { ttl: 21600 }),
]);

/* ────────────────────────────── open government data ────────────────────────────── */

const ckan = (slug, displayName, description, host, tags) =>
  api("open-data", slug, displayName, description, `https://${host}`, ["open-data", "government", "datasets", ...tags], [
    get("datasets", "Search datasets", "CKAN package search.", [f.req("query", { example: "air quality" }), lim(10, 1000, "rows")], (p) => url(`https://${host}${host === "data.gov.uk" ? "/api/action" : host === "open.canada.ca" ? "/data/api/action" : "/api/3/action"}/package_search`, { q: p.query, rows: p.rows }), { ttl: 3600 }),
  ]);
const dataGov = ckan("data-gov", "Data.gov (US)", "Search 300,000+ US government datasets.", "catalog.data.gov", ["usa"]);
const dataGovUk = ckan("data-gov-uk", "data.gov.uk", "Search UK government datasets.", "data.gov.uk", ["uk"]);
const openCanada = ckan("open-canada", "Open Government Canada", "Search Government of Canada open datasets.", "open.canada.ca", ["canada"]);

const euData = api("open-data", "data-europa", "data.europa.eu", "The official portal for European data: 1.6M+ datasets from EU institutions and member states.", "https://data.europa.eu", ["open-data", "europe", "eu", "datasets"], [
  get("datasets", "Search datasets", "Search the European data portal.", [f.req("query", { example: "renewable energy" }), lim(10, 1000)], (p) => url("https://data.europa.eu/api/hub/search/search", { q: p.query, limit: p.limit, filter: "dataset" }), { ttl: 3600 }),
]);

const eurostat = api("open-data", "eurostat", "Eurostat", "Official EU statistics (JSON-stat): population, GDP, prices, energy and thousands more datasets.", "https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction", ["statistics", "europe", "economics", "json-stat"], [
  get("dataset", "Dataset", "Observations for a dataset code, optionally filtered by country and start period.", [f.req("dataset", { example: "nama_10_gdp" }), f.str("geo", { example: "DE" }), f.str("sinceTimePeriod", { example: "2018" }), f.str("unit", { example: "CP_MEUR" }), f.str("naItem", { example: "B1GQ" })],
    (p) => url(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${enc(p.dataset)}`, { format: "JSON", lang: "EN", geo: p.geo, sinceTimePeriod: p.sinceTimePeriod, unit: p.unit, na_item: p.naItem }), { ttl: 86400 }),
]);

const federalRegister = api("open-data", "federal-register", "Federal Register", "Daily journal of the US government: rules, proposed rules, notices and executive orders.", "https://www.federalregister.gov/developers/documentation/api/v1", ["usa", "regulation", "law", "government"], [
  get("documents", "Search documents", "Full-text search.", [f.req("term", { example: "artificial intelligence" }), lim(20, 1000, "perPage"), f.enm("type", ["RULE", "PRORULE", "NOTICE", "PRESDOCU"])],
    (p) => url("https://www.federalregister.gov/api/v1/documents.json", { "conditions[term]": p.term, "conditions[type][]": p.type, per_page: p.perPage, order: "newest" }), { ttl: 3600 }),
]);

const ukPolice = api("open-data", "uk-police", "UK Police Data", "Street-level crime, outcomes and police forces in England, Wales and Northern Ireland.", "https://data.police.uk/docs/", ["crime", "uk", "police"], [
  get("crimes", "Street crimes", "Crimes within one mile of a point.", [f.req("lat", { type: "number", example: 52.629729 }), f.req("lng", { type: "number", example: -1.131592 }), f.str("date", { example: "2024-01", description: "YYYY-MM" })],
    (p) => url("https://data.police.uk/api/crimes-street/all-crime", { lat: p.lat, lng: p.lng, date: p.date }), { ttl: 86400 }),
  get("forces", "Forces", "Police forces.", [], () => "https://data.police.uk/api/forces", { ttl: 604800 }),
]);

const fbiWanted = api("open-data", "fbi-wanted", "FBI Wanted", "Public FBI wanted notices and missing persons.", "https://api.fbi.gov/docs", ["fbi", "usa", "public-safety"], [
  get("list", "Notices", "Search notices by title or field office.", [f.str("title"), f.str("fieldOffice", { example: "newyork" }), f.int("page", { default: 1, min: 1 })], (p) => url("https://api.fbi.gov/wanted/v1/list", { title: p.title, field_offices: p.fieldOffice, page: p.page }), { ttl: 3600 }),
]);

/* ────────────────────────────── culture, games, fun ────────────────────────────── */

const met = api("media", "met-museum", "The Met Museum", "470,000+ artworks from The Metropolitan Museum of Art, many with public-domain images.", "https://metmuseum.github.io", ["art", "museum", "culture", "images"], [
  get("search", "Search", "Object ids matching a query.", [f.req("query", { example: "sunflowers" }), f.bool("hasImages", { default: true })], (p) => url("https://collectionapi.metmuseum.org/public/collection/v1/search", { q: p.query, hasImages: p.hasImages }), { ttl: 86400 }),
  get("object", "Object", "One object with images and metadata.", [f.req("id", { type: "integer", example: 436524 })], (p) => `https://collectionapi.metmuseum.org/public/collection/v1/objects/${p.id}`, { ttl: 604800 }),
  get("departments", "Departments", "Curatorial departments.", [], () => "https://collectionapi.metmuseum.org/public/collection/v1/departments", { ttl: 604800 }),
]);

const artic = api("media", "art-institute-chicago", "Art Institute of Chicago", "Artworks, artists and exhibitions with IIIF images.", "https://api.artic.edu/docs/", ["art", "museum", "culture", "iiif"], [
  get("search", "Search artworks", "Full-text search.", [f.req("query", { example: "monet" }), lim(10, 100), f.str("fields", { default: "id,title,artist_display,date_display,image_id,thumbnail" })],
    (p) => url("https://api.artic.edu/api/v1/artworks/search", { q: p.query, limit: p.limit, fields: p.fields }), { ttl: 86400 }),
  get("artwork", "Artwork", "One artwork. Image URL: https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg", [f.req("id", { type: "integer", example: 27992 })], (p) => `https://api.artic.edu/api/v1/artworks/${p.id}`, { ttl: 604800 }),
]);

const cocktails = api("food", "thecocktaildb", "TheCocktailDB", "Cocktail recipes, ingredients and images (free tier).", "https://www.thecocktaildb.com/api.php", ["cocktails", "drinks", "recipes"], [
  get("search", "Search", "Cocktails by name.", [f.req("name", { example: "margarita" })], (p) => url("https://www.thecocktaildb.com/api/json/v1/1/search.php", { s: p.name }), { ttl: 86400 }),
  get("by-ingredient", "By ingredient", "Cocktails containing an ingredient.", [f.req("ingredient", { example: "gin" })], (p) => url("https://www.thecocktaildb.com/api/json/v1/1/filter.php", { i: p.ingredient }), { ttl: 86400 }),
  get("lookup", "Lookup", "Full recipe by id.", [f.req("id", { example: "11007" })], (p) => url("https://www.thecocktaildb.com/api/json/v1/1/lookup.php", { i: p.id }), { ttl: 604800 }),
  get("random", "Random", "One random cocktail.", [], () => "https://www.thecocktaildb.com/api/json/v1/1/random.php", { ttl: 0 }),
]);

const breweries = api("food", "open-brewery-db", "Open Brewery DB", "Breweries, cideries and brewpubs worldwide.", "https://www.openbrewerydb.org/documentation", ["beer", "breweries"], [
  get("list", "Breweries", "Filter by city, state or country.", [f.str("city", { example: "portland" }), f.str("state"), f.str("country", { example: "ireland" }), lim(20, 200, "perPage")],
    (p) => url("https://api.openbrewerydb.org/v1/breweries", { by_city: p.city, by_state: p.state, by_country: p.country, per_page: p.perPage }), { ttl: 86400 }),
  get("search", "Search", "Search by name.", [f.req("query", { example: "dog" }), lim(20, 200, "perPage")], (p) => url("https://api.openbrewerydb.org/v1/breweries/search", { query: p.query, per_page: p.perPage }), { ttl: 86400 }),
]);

const fruityvice = api("food", "fruityvice", "Fruityvice", "Nutrition facts for fruits.", "https://www.fruityvice.com", ["fruit", "nutrition"], [
  get("fruit", "Fruit", "Nutrition for one fruit.", [f.req("name", { example: "banana" })], (p) => `https://www.fruityvice.com/api/fruit/${enc(p.name)}`, { ttl: 604800 }),
  get("all", "All fruits", "Every fruit in the database.", [], () => "https://www.fruityvice.com/api/fruit/all", { ttl: 604800 }),
]);

const chess = api("games", "chess-com", "Chess.com", "Public player profiles, ratings and leaderboards from Chess.com.", "https://www.chess.com/news/view/published-data-api", ["chess", "games", "ratings"], [
  get("player", "Player", "Public profile.", [f.req("username", { example: "hikaru" })], (p) => `https://api.chess.com/pub/player/${enc(p.username.toLowerCase())}`, { ttl: 3600 }),
  get("stats", "Player stats", "Ratings by time control.", [f.req("username", { example: "magnuscarlsen" })], (p) => `https://api.chess.com/pub/player/${enc(p.username.toLowerCase())}/stats`, { ttl: 3600 }),
  get("leaderboards", "Leaderboards", "Top players in every category.", [], () => "https://api.chess.com/pub/leaderboards", { ttl: 3600 }),
  get("titled", "Titled players", "Usernames of titled players.", [f.enm("title", ["GM", "WGM", "IM", "WIM", "FM", "WFM", "NM", "WNM", "CM", "WCM"], { required: true, example: "GM" })], (p) => `https://api.chess.com/pub/titled/${p.title}`, { ttl: 86400 }),
]);

const freetogame = api("games", "freetogame", "FreeToGame", "Free-to-play PC and browser games.", "https://www.freetogame.com/api-doc", ["games", "free-to-play"], [
  get("games", "Games", "Filter by platform and category.", [f.enm("platform", ["pc", "browser", "all"], { default: "all" }), f.str("category", { example: "shooter" }), f.enm("sortBy", ["release-date", "popularity", "alphabetical", "relevance"], { default: "popularity" })],
    (p) => url("https://www.freetogame.com/api/games", { platform: p.platform, category: p.category, "sort-by": p.sortBy }), { ttl: 21600 }),
  get("game", "Game", "Details for one game.", [f.req("id", { type: "integer", example: 452 })], (p) => url("https://www.freetogame.com/api/game", { id: p.id }), { ttl: 86400 }),
]);

const steamStore = api("games", "steam-store", "Steam Store", "Public Steam store data: app details, prices and search.", "https://store.steampowered.com", ["steam", "games", "pc"], [
  get("app", "App details", "Price, description, genres and release date.", [f.req("appId", { example: "570" }), f.str("country", { default: "us" })], (p) => url("https://store.steampowered.com/api/appdetails", { appids: p.appId, cc: p.country, l: "english" }), { ttl: 21600 }),
  get("search", "Search", "Store search.", [f.req("term", { example: "portal" }), f.str("country", { default: "US" })], (p) => url("https://store.steampowered.com/api/storesearch/", { term: p.term, cc: p.country, l: "english" }), { ttl: 21600 }),
]);

const trivia = api("games", "open-trivia-db", "Open Trivia DB", "4,000+ verified trivia questions in 24 categories.", "https://opentdb.com/api_config.php", ["trivia", "quiz", "questions"], [
  get("questions", "Questions", "Random questions.", [lim(10, 50, "amount"), f.int("category", { description: "Category id (see categories)" }), f.enm("difficulty", ["easy", "medium", "hard"]), f.enm("type", ["multiple", "boolean"])],
    (p) => url("https://opentdb.com/api.php", { amount: p.amount, category: p.category, difficulty: p.difficulty, type: p.type }), { ttl: 0 }),
  get("categories", "Categories", "Category ids.", [], () => "https://opentdb.com/api_category.php", { ttl: 604800 }),
]);

const deck = api("games", "deck-of-cards", "Deck of Cards", "Shuffle and draw from virtual decks of playing cards.", "https://deckofcardsapi.com", ["cards", "games", "random"], [
  get("new", "New deck", "A new shuffled deck.", [f.int("decks", { default: 1, min: 1, max: 20 })], (p) => url("https://deckofcardsapi.com/api/deck/new/shuffle/", { deck_count: p.decks }), { ttl: 0 }),
  get("draw", "Draw", "Draw cards from a deck.", [f.req("deckId", { example: "new" }), f.int("count", { default: 2, min: 1, max: 52 })], (p) => url(`https://deckofcardsapi.com/api/deck/${enc(p.deckId)}/draw/`, { count: p.count }), { ttl: 0 }),
]);

const f1 = api("entertainment", "formula-1", "Formula 1 (Jolpica-F1)", "Formula 1 results, standings and schedules since 1950 (Ergast-compatible).", "https://github.com/jolpica/jolpica-f1", ["f1", "motorsport", "racing", "sports"], [
  get("schedule", "Season schedule", "Races in a season.", [f.str("season", { default: "current" })], (p) => `https://api.jolpi.ca/ergast/f1/${enc(p.season)}.json`, { ttl: 3600 }),
  get("driver-standings", "Driver standings", "Championship table.", [f.str("season", { default: "current" })], (p) => `https://api.jolpi.ca/ergast/f1/${enc(p.season)}/driverStandings.json`, { ttl: 3600 }),
  get("constructor-standings", "Constructor standings", "Team table.", [f.str("season", { default: "current" })], (p) => `https://api.jolpi.ca/ergast/f1/${enc(p.season)}/constructorStandings.json`, { ttl: 3600 }),
  get("results", "Race results", "Results of one round.", [f.str("season", { default: "current" }), f.str("round", { default: "last" })], (p) => `https://api.jolpi.ca/ergast/f1/${enc(p.season)}/${enc(p.round)}/results.json`, { ttl: 3600 }),
]);

const openf1 = api("entertainment", "openf1", "OpenF1", "Live and historical Formula 1 timing: sessions, drivers, laps and positions.", "https://openf1.org", ["f1", "telemetry", "motorsport", "sports"], [
  get("sessions", "Sessions", "Sessions by year or country.", [f.int("year", { example: 2025 }), f.str("country", { example: "Monaco" }), f.str("sessionName", { example: "Race" })],
    (p) => url("https://api.openf1.org/v1/sessions", { year: p.year, country_name: p.country, session_name: p.sessionName }), { ttl: 3600 }),
  get("drivers", "Drivers", "Drivers in a session.", [f.str("sessionKey", { default: "latest" })], (p) => url("https://api.openf1.org/v1/drivers", { session_key: p.sessionKey }), { ttl: 600 }),
  get("positions", "Positions", "Position changes in a session.", [f.str("sessionKey", { default: "latest" }), f.int("driverNumber")], (p) => url("https://api.openf1.org/v1/position", { session_key: p.sessionKey, driver_number: p.driverNumber }), { ttl: 60 }),
]);

const mlb = api("entertainment", "mlb-stats", "MLB Stats", "Major League Baseball schedules, scores, teams and standings.", "https://statsapi.mlb.com", ["baseball", "mlb", "sports"], [
  get("schedule", "Schedule", "Games on a date.", [date("date", { example: "2025-07-04" })], (p) => url("https://statsapi.mlb.com/api/v1/schedule", { sportId: 1, date: p.date }), { ttl: 300 }),
  get("teams", "Teams", "MLB teams.", [f.int("season")], (p) => url("https://statsapi.mlb.com/api/v1/teams", { sportId: 1, season: p.season }), { ttl: 86400 }),
  get("standings", "Standings", "League standings.", [f.int("season", { example: 2025 }), f.str("leagueId", { default: "103,104" })], (p) => url("https://statsapi.mlb.com/api/v1/standings", { leagueId: p.leagueId, season: p.season }), { ttl: 3600 }),
]);

const nhl = api("entertainment", "nhl", "NHL", "National Hockey League standings, schedules and live scores.", "https://api-web.nhle.com", ["hockey", "nhl", "sports"], [
  get("standings", "Standings", "Current standings.", [], () => "https://api-web.nhle.com/v1/standings/now", { ttl: 900 }),
  get("scores", "Scores", "Today's scores.", [], () => "https://api-web.nhle.com/v1/score/now", { ttl: 60 }),
  get("schedule", "Schedule", "This week's schedule.", [], () => "https://api-web.nhle.com/v1/schedule/now", { ttl: 900 }),
]);

const sportsDb = api("entertainment", "thesportsdb", "TheSportsDB", "Teams, players, leagues and events across many sports (free public tier).", "https://www.thesportsdb.com/free_sports_api", ["sports", "football", "teams", "players"], [
  get("teams", "Search teams", "Teams by name.", [f.req("name", { example: "Arsenal" })], (p) => url("https://www.thesportsdb.com/api/v1/json/3/searchteams.php", { t: p.name }), { ttl: 86400 }),
  get("players", "Search players", "Players by name.", [f.req("name", { example: "Danny Welbeck" })], (p) => url("https://www.thesportsdb.com/api/v1/json/3/searchplayers.php", { p: p.name }), { ttl: 86400 }),
  get("next-events", "Next events", "Upcoming events for a team id.", [f.req("teamId", { example: "133604" })], (p) => url("https://www.thesportsdb.com/api/v1/json/3/eventsnext.php", { id: p.teamId }), { ttl: 3600 }),
]);

const spacex = api("open-data", "spacex", "SpaceX", "Launches, rockets, capsules and Starlink data from the open-source SpaceX API.", "https://github.com/r-spacex/SpaceX-API", ["space", "rockets", "launches"], [
  get("latest-launch", "Latest launch", "Most recent launch.", [], () => "https://api.spacexdata.com/v5/launches/latest", { ttl: 3600 }),
  get("upcoming-launches", "Upcoming launches", "Scheduled launches.", [], () => "https://api.spacexdata.com/v5/launches/upcoming", { ttl: 3600 }),
  get("rockets", "Rockets", "Rocket specifications.", [], () => "https://api.spacexdata.com/v4/rockets", { ttl: 86400 }),
]);

const launchLibrary = api("open-data", "launch-library", "Launch Library 2", "Every orbital launch from every agency: upcoming launches, rockets and astronauts (The Space Devs).", "https://thespacedevs.com/llapi", ["space", "launches", "rockets", "astronauts"], [
  get("upcoming", "Upcoming launches", "Next launches worldwide.", [lim(10, 100)], (p) => url("https://ll.thespacedevs.com/2.2.0/launch/upcoming/", { limit: p.limit, mode: "list" }), { ttl: 1800 }),
  get("astronauts", "Astronauts", "Search astronauts.", [f.str("search", { example: "Peake" }), lim(10, 100)], (p) => url("https://ll.thespacedevs.com/2.2.0/astronaut/", { search: p.search, limit: p.limit }), { ttl: 86400 }),
]);

const radio = api("music", "radio-browser", "Radio Browser", "40,000+ internet radio stations with stream URLs, tags and countries.", "https://www.radio-browser.info", ["radio", "streams", "music"], [
  get("search", "Search stations", "By name, country or tag.", [f.str("name", { example: "jazz" }), f.str("countryCode", { example: "FR" }), f.str("tag"), lim(20, 500)],
    (p) => url("https://de1.api.radio-browser.info/json/stations/search", { name: p.name, countrycode: p.countryCode, tag: p.tag, limit: p.limit, hidebroken: "true", order: "clickcount", reverse: "true" }), { ttl: 3600 }),
  get("top", "Most played", "Top stations by clicks.", [lim(20, 500)], (p) => `https://de1.api.radio-browser.info/json/stations/topclick/${p.limit ?? 20}`, { ttl: 3600 }),
]);

const lemmy = api("social-media", "lemmy", "Lemmy (lemmy.world)", "Posts and communities from Lemmy, the federated link aggregator.", "https://join-lemmy.org/api/", ["fediverse", "forums", "social"], [
  get("posts", "Posts", "Hot or new posts, optionally in one community.", [f.enm("sort", ["Hot", "New", "TopDay", "TopWeek", "Active"], { default: "Hot" }), f.str("community", { example: "technology" }), lim(20, 50)],
    (p) => url("https://lemmy.world/api/v3/post/list", { sort: p.sort, community_name: p.community, limit: p.limit }), { ttl: 300 }),
  get("communities", "Communities", "Popular communities.", [lim(20, 50)], (p) => url("https://lemmy.world/api/v3/community/list", { sort: "TopMonth", limit: p.limit }), { ttl: 3600 }),
]);

const jokes = api("entertainment", "jokeapi", "JokeAPI", "Programming, pun and general jokes with safe-mode filtering.", "https://v2.jokeapi.dev", ["jokes", "humor", "fun"], [
  get("joke", "Joke", "Random joke.", [f.enm("category", ["Any", "Programming", "Misc", "Pun", "Spooky", "Christmas"], { default: "Programming" }), f.enm("type", ["single", "twopart"]), f.int("amount", { default: 1, min: 1, max: 10 })],
    (p) => url(`https://v2.jokeapi.dev/joke/${p.category}`, { type: p.type, amount: p.amount }) + (p.type || p.amount ? "&" : "?") + "safe-mode", { ttl: 0 }),
]);

const dogs = api("media", "dog-ceo", "Dog CEO", "20,000+ dog photos by breed.", "https://dog.ceo/dog-api/", ["dogs", "images", "animals"], [
  get("random", "Random photos", "Random dog images.", [f.int("count", { default: 1, min: 1, max: 50 })], (p) => `https://dog.ceo/api/breeds/image/random/${p.count ?? 1}`, { ttl: 0 }),
  get("breed", "By breed", "Random images of one breed.", [f.req("breed", { example: "husky" }), f.int("count", { default: 3, min: 1, max: 50 })], (p) => `https://dog.ceo/api/breed/${enc(p.breed.toLowerCase())}/images/random/${p.count ?? 3}`, { ttl: 0 }),
  get("breeds", "Breeds", "Every breed and sub-breed.", [], () => "https://dog.ceo/api/breeds/list/all", { ttl: 604800 }),
]);

const catFacts = api("entertainment", "cat-facts", "Cat Facts", "Random cat facts and breeds.", "https://catfact.ninja", ["cats", "facts", "animals"], [
  get("fact", "Random fact", "One random fact.", [], () => "https://catfact.ninja/fact", { ttl: 0 }),
  get("breeds", "Breeds", "Cat breeds.", [lim(25, 100)], (p) => url("https://catfact.ninja/breeds", { limit: p.limit }), { ttl: 604800 }),
]);

const bible = api("education", "bible-api", "Bible API", "Bible verses and passages in public-domain translations.", "https://bible-api.com", ["bible", "scripture", "religion"], [
  get("passage", "Passage", "A verse or range, e.g. John 3:16 or Romans 12:1-2.", [f.req("reference", { example: "John 3:16" }), f.enm("translation", ["web", "kjv", "bbe", "asv", "ylt", "almeida", "rccv"], { default: "web" })],
    (p) => url(`https://bible-api.com/${enc(p.reference)}`, { translation: p.translation }), { ttl: 604800 }),
]);

const poetry = api("education", "poetrydb", "PoetryDB", "Classic poems by title, author or line count.", "https://poetrydb.org", ["poetry", "literature", "poems"], [
  get("by-author", "By author", "Poems by an author.", [f.req("author", { example: "Emily Dickinson" })], (p) => `https://poetrydb.org/author/${enc(p.author)}`, { ttl: 604800 }),
  get("by-title", "By title", "Poems with a title.", [f.req("title", { example: "Ozymandias" })], (p) => `https://poetrydb.org/title/${enc(p.title)}`, { ttl: 604800 }),
  get("random", "Random", "Random poems.", [f.int("count", { default: 1, min: 1, max: 20 })], (p) => `https://poetrydb.org/random/${p.count ?? 1}`, { ttl: 0 }),
]);

const nameStats = api("ai", "name-insights", "Agify, Genderize, Nationalize", "Predict age, gender and nationality from a first name (100 free names a day).", "https://agify.io", ["names", "demographics", "prediction"], [
  get("age", "Age", "Estimated age for a name.", [f.req("name", { example: "michael" }), f.str("countryId", { example: "US" })], (p) => url("https://api.agify.io", { name: p.name, country_id: p.countryId }), { ttl: 604800 }),
  get("gender", "Gender", "Gender probability for a name.", [f.req("name", { example: "andrea" }), f.str("countryId", { example: "IT" })], (p) => url("https://api.genderize.io", { name: p.name, country_id: p.countryId }), { ttl: 604800 }),
  get("nationality", "Nationality", "Likely countries for a name.", [f.req("name", { example: "nathaniel" })], (p) => url("https://api.nationalize.io", { name: p.name }), { ttl: 604800 }),
]);

const advice = api("entertainment", "advice-slip", "Advice Slip", "Random pieces of advice, or search them.", "https://api.adviceslip.com", ["advice", "quotes", "fun"], [
  get("random", "Random advice", "One random slip.", [], () => "https://api.adviceslip.com/advice", { ttl: 0 }),
  get("search", "Search", "Slips containing a word.", [f.req("query", { example: "love" })], (p) => `https://api.adviceslip.com/advice/search/${enc(p.query)}`, { ttl: 86400 }),
]);

export default [
  openMeteo, nominatim, zippopotam, restCountries, sunrise, nws, usgs, opensky, aviationWeather, citybikes, carbonUk, ukFloods, noaaTides, nager, issNow,
  frankfurter, coinpaprika, kraken, coinbase, bitstamp, kucoin, gate, dexscreener, dbnomics,
  openalex, crossref, semanticScholar, openLibrary, gutendex, universities, datamuse, dictionary, wikidata, wikiPageviews,
  gbif, inaturalist, openFda, rxnorm, diseaseSh,
  nvd, epss, cisaKev, internetdb, pwned, crtsh,
  pypi, crates, rubygems, packagist, nuget, goProxy, maven, dockerHubPublic, gitlabPublic, endoflife, codeforces,
  dataGov, dataGovUk, openCanada, euData, eurostat, federalRegister, ukPolice, fbiWanted,
  met, artic, cocktails, breweries, fruityvice, chess, freetogame, steamStore, trivia, deck, f1, openf1, mlb, nhl, sportsDb, spacex, launchLibrary, radio, lemmy, jokes, dogs, catFacts, bible, poetry, nameStats, advice,
];
