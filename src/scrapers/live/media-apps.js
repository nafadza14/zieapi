// Live scrapers for media, games, food, health, app-store and temp-mail sources.
// Every endpoint here talks to an official / documented public API.

import { url, getJson, postJson, getText, stripHtml, decodeEntities, num, env, f, ScraperError } from "../kit.js";

// ---------------------------------------------------------------------------
// shared helpers

/** Endpoint builder. `path` may be "slug" or "slug/:param". */
function ep(path, displayName, description, fields, handler, opts = {}) {
  const [slug, ...rest] = path.split("/");
  return {
    slug,
    displayName,
    description,
    method: "GET",
    cacheTtl: 3600,
    pathTemplate: rest.length ? rest.join("/") : null,
    bulkEnabled: true,
    fields,
    handler,
    ...opts,
  };
}

const pageF = (max = 100) => f.int("page", { default: 1, min: 1, max, description: "1-based page number" });
const countF = (name = "count", def = 20, max = 100) => f.int(name, { default: def, min: 1, max, description: "Items per page" });
const countryF = (def = "us") => f.str("country", { default: def, pattern: "^[A-Za-z]{2}$", description: "Two-letter storefront country code", example: "us" });

function paginate(list, page = 1, count = 20) {
  const start = (page - 1) * count;
  return { page, count, total: list.length, hasMore: start + count < list.length, items: list.slice(start, start + count) };
}

const clean = (s) => (s == null || s === "" ? null : stripHtml(s) || null);
const names = (arr, key = "name") => (Array.isArray(arr) ? arr.map((x) => x?.[key]).filter(Boolean) : []);

function randomString(len, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789") {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ---------------------------------------------------------------------------
// TVmaze: https://www.tvmaze.com/api

const TVMAZE = "https://api.tvmaze.com";

function tvShow(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    type: s.type ?? null,
    language: s.language ?? null,
    genres: s.genres ?? [],
    status: s.status ?? null,
    runtime: s.runtime ?? s.averageRuntime ?? null,
    premiered: s.premiered ?? null,
    ended: s.ended ?? null,
    officialSite: s.officialSite ?? null,
    schedule: s.schedule ?? null,
    rating: s.rating?.average ?? null,
    network: s.network?.name ?? s.webChannel?.name ?? null,
    country: s.network?.country?.code ?? s.webChannel?.country?.code ?? null,
    externals: s.externals ?? null,
    image: s.image?.original ?? s.image?.medium ?? null,
    summary: clean(s.summary),
    updated: s.updated ?? null,
  };
}
function tvPerson(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    country: p.country?.name ?? null,
    birthday: p.birthday ?? null,
    deathday: p.deathday ?? null,
    gender: p.gender ?? null,
    image: p.image?.original ?? p.image?.medium ?? null,
  };
}
function tvEpisode(e) {
  if (!e) return null;
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    season: e.season,
    number: e.number,
    type: e.type ?? null,
    airdate: e.airdate || null,
    airtime: e.airtime || null,
    airstamp: e.airstamp ?? null,
    runtime: e.runtime ?? null,
    rating: e.rating?.average ?? null,
    image: e.image?.original ?? e.image?.medium ?? null,
    summary: clean(e.summary),
  };
}

const tvmaze = {
  category: "movie",
  slug: "tvmaze",
  displayName: "TVmaze",
  description: "TV show, episode, cast, people and airing-schedule data from the public TVmaze API.",
  tags: ["tv", "shows", "episodes", "schedule"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Find TV shows and/or people by name.",
      [f.req("q", { example: "the office", description: "Search text" }), f.enm("type", ["all", "show", "person"], { default: "show" }), countF("limit", 10, 50)],
      async ({ q, type, limit }, ctx) => {
        const out = { query: q, type };
        if (type !== "person") {
          const j = await getJson(ctx, url(`${TVMAZE}/search/shows`, { q }));
          out.shows = j.slice(0, limit).map((r) => ({ score: r.score, ...tvShow(r.show) }));
        }
        if (type !== "show") {
          const j = await getJson(ctx, url(`${TVMAZE}/search/people`, { q }));
          out.people = j.slice(0, limit).map((r) => ({ score: r.score, ...tvPerson(r.person) }));
        }
        return out;
      },
    ),
    ep("show/:id", "Show", "Full details for one show by TVmaze id.", [f.req("id", { pattern: "^\\d+$", example: "526" })], async ({ id }, ctx) =>
      tvShow(await getJson(ctx, `${TVMAZE}/shows/${id}`)),
    ),
    ep(
      "episodes/:id",
      "Episodes",
      "Episode list of a show, optionally limited to one season.",
      [f.req("id", { pattern: "^\\d+$", example: "526" }), f.int("season", { min: 0 }), pageF(500), countF("count", 50, 200)],
      async ({ id, season, page, count }, ctx) => {
        let eps = (await getJson(ctx, `${TVMAZE}/shows/${id}/episodes`)).map(tvEpisode);
        if (season !== undefined) eps = eps.filter((e) => e.season === season);
        const p = paginate(eps, page, count);
        return { showId: Number(id), season: season ?? null, page: p.page, count: p.count, total: p.total, hasMore: p.hasMore, episodes: p.items };
      },
    ),
    ep("episode/:id", "Episode", "One episode by TVmaze episode id.", [f.req("id", { pattern: "^\\d+$", example: "1" })], async ({ id }, ctx) =>
      tvEpisode(await getJson(ctx, `${TVMAZE}/episodes/${id}`)),
    ),
    ep(
      "cast/:id",
      "Cast",
      "Main cast of a show with the characters they play.",
      [f.req("id", { pattern: "^\\d+$", example: "526" }), pageF(), countF("count", 50, 200)],
      async ({ id, page, count }, ctx) => {
        const cast = (await getJson(ctx, `${TVMAZE}/shows/${id}/cast`)).map((c) => ({
          person: tvPerson(c.person),
          character: c.character ? { id: c.character.id, name: c.character.name, image: c.character.image?.medium ?? null } : null,
          self: !!c.self,
          voice: !!c.voice,
        }));
        const p = paginate(cast, page, count);
        return { showId: Number(id), page: p.page, count: p.count, total: p.total, hasMore: p.hasMore, cast: p.items };
      },
    ),
    ep("person/:id", "Person", "One person by TVmaze id.", [f.req("id", { pattern: "^\\d+$", example: "1" })], async ({ id }, ctx) =>
      tvPerson(await getJson(ctx, `${TVMAZE}/people/${id}`)),
    ),
    ep(
      "schedule",
      "Schedule",
      "Episodes airing on a given day for a country (broadcast TV) or on streaming services (web).",
      [
        f.str("country", { default: "US", pattern: "^[A-Za-z]{2}$", description: "ISO country code" }),
        f.str("date", { pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD, defaults to today", example: "2024-01-15" }),
        f.bool("web", { default: false, description: "Use the web/streaming schedule" }),
        countF("limit", 100, 500),
      ],
      async ({ country, date, web, limit }, ctx) => {
        const target = web
          ? url(`${TVMAZE}/schedule/web`, { date, country: country?.toUpperCase() })
          : url(`${TVMAZE}/schedule`, { country: country?.toUpperCase(), date });
        const j = await getJson(ctx, target);
        const items = j.slice(0, limit).map((e) => ({ ...tvEpisode(e), show: tvShow(e.show ?? e._embedded?.show) }));
        return { country: country?.toUpperCase() ?? null, date: date ?? null, web, total: j.length, count: items.length, episodes: items };
      },
      { cacheTtl: 900 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// AniList: GraphQL https://graphql.anilist.co

const ANILIST = "https://graphql.anilist.co";
const MEDIA_FIELDS = `id idMal type format status season seasonYear episodes duration chapters volumes genres averageScore meanScore popularity favourites isAdult siteUrl bannerImage
  title { romaji english native } description(asHtml: false) startDate { year month day } endDate { year month day } coverImage { extraLarge large color }`;
const MEDIA_DETAIL = `${MEDIA_FIELDS} synonyms source countryOfOrigin hashtag trailer { id site } nextAiringEpisode { episode airingAt timeUntilAiring }
  studios(isMain: true) { nodes { id name } } tags { name rank isMediaSpoiler } externalLinks { site url }
  relations { edges { relationType node { id type format title { romaji english } } } }`;
const PAGE_INFO = "pageInfo { total currentPage lastPage hasNextPage perPage }";

async function anilist(ctx, query, variables) {
  const j = await postJson(ctx, ANILIST, { query, variables });
  if (j?.errors?.length) throw new ScraperError(j.errors[0].message ?? "AniList error", { status: j.errors[0].status, context: { errors: j.errors } });
  return j.data;
}
const fuzzyDate = (d) => (d?.year ? [d.year, d.month, d.day].filter(Boolean).map((x) => String(x).padStart(2, "0")).join("-") : null);
function aniMedia(m, detail = false) {
  if (!m) return null;
  const out = {
    id: m.id,
    idMal: m.idMal ?? null,
    type: m.type,
    format: m.format ?? null,
    status: m.status ?? null,
    title: m.title,
    description: clean(m.description),
    season: m.season ?? null,
    seasonYear: m.seasonYear ?? null,
    startDate: fuzzyDate(m.startDate),
    endDate: fuzzyDate(m.endDate),
    episodes: m.episodes ?? null,
    duration: m.duration ?? null,
    chapters: m.chapters ?? null,
    volumes: m.volumes ?? null,
    genres: m.genres ?? [],
    averageScore: m.averageScore ?? null,
    meanScore: m.meanScore ?? null,
    popularity: m.popularity ?? null,
    favourites: m.favourites ?? null,
    isAdult: !!m.isAdult,
    cover: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
    banner: m.bannerImage ?? null,
    url: m.siteUrl,
  };
  if (detail) {
    Object.assign(out, {
      synonyms: m.synonyms ?? [],
      source: m.source ?? null,
      countryOfOrigin: m.countryOfOrigin ?? null,
      hashtag: m.hashtag ?? null,
      trailer: m.trailer?.site === "youtube" ? `https://www.youtube.com/watch?v=${m.trailer.id}` : m.trailer ?? null,
      nextAiringEpisode: m.nextAiringEpisode ?? null,
      studios: names(m.studios?.nodes),
      tags: (m.tags ?? []).map((t) => ({ name: t.name, rank: t.rank, spoiler: !!t.isMediaSpoiler })),
      externalLinks: m.externalLinks ?? [],
      relations: (m.relations?.edges ?? []).map((e) => ({ relation: e.relationType, id: e.node?.id, type: e.node?.type, format: e.node?.format, title: e.node?.title })),
    });
  }
  return out;
}
const aniType = (t) => (t ? t.toUpperCase() : undefined);
async function aniPage(ctx, filterArgs, filterVars, vars) {
  const decl = ["$page: Int", "$perPage: Int", ...filterVars].join(", ");
  const q = `query (${decl}) { Page(page: $page, perPage: $perPage) { ${PAGE_INFO} media(${filterArgs}) { ${MEDIA_FIELDS} } } }`;
  const d = await anilist(ctx, q, vars);
  return { pageInfo: d.Page.pageInfo, results: d.Page.media.map((m) => aniMedia(m)) };
}

const anilistScraper = {
  category: "movie",
  slug: "anilist",
  displayName: "AniList",
  description: "Anime and manga metadata, characters, staff and seasonal charts from AniList's public GraphQL API.",
  tags: ["anime", "manga", "graphql"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search anime or manga by title.",
      [
        f.req("q", { example: "frieren" }),
        f.enm("type", ["anime", "manga"], { default: "anime" }),
        f.enm("sort", ["relevance", "popularity", "score", "trending"], { default: "relevance" }),
        pageF(),
        countF("count", 20, 50),
      ],
      ({ q, type, sort, page, count }, ctx) => {
        const sortMap = { relevance: "SEARCH_MATCH", popularity: "POPULARITY_DESC", score: "SCORE_DESC", trending: "TRENDING_DESC" };
        return aniPage(ctx, "search: $search, type: $type, sort: [$sort]", ["$search: String", "$type: MediaType", "$sort: MediaSort"], {
          page,
          perPage: count,
          search: q,
          type: aniType(type),
          sort: sortMap[sort],
        });
      },
    ),
    ep(
      "media/:id",
      "Media",
      "Full record of one anime or manga by AniList id.",
      [f.int("id", { required: true, min: 1, example: 154587 }), f.enm("type", ["anime", "manga"])],
      async ({ id, type }, ctx) => {
        const d = await anilist(ctx, `query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${MEDIA_DETAIL} } }`, { id, type: aniType(type) });
        return aniMedia(d.Media, true);
      },
    ),
    ep(
      "seasonal",
      "Seasonal",
      "Anime airing in a given season, most popular first.",
      [f.enm("season", ["WINTER", "SPRING", "SUMMER", "FALL"], { required: true, example: "FALL" }), f.int("year", { required: true, min: 1940, max: 2100, example: 2024 }), pageF(), countF("count", 20, 50)],
      ({ season, year, page, count }, ctx) =>
        aniPage(ctx, "season: $season, seasonYear: $year, type: ANIME, sort: [POPULARITY_DESC]", ["$season: MediaSeason", "$year: Int"], {
          page,
          perPage: count,
          season,
          year,
        }),
    ),
    ep(
      "trending",
      "Trending",
      "What is trending on AniList right now.",
      [f.enm("type", ["anime", "manga"], { default: "anime" }), pageF(), countF("count", 20, 50)],
      ({ type, page, count }, ctx) => aniPage(ctx, "type: $type, sort: [TRENDING_DESC]", ["$type: MediaType"], { page, perPage: count, type: aniType(type) }),
      { cacheTtl: 900 },
    ),
    ep("character/:id", "Character", "A character with the media they appear in.", [f.int("id", { required: true, min: 1, example: 40 })], async ({ id }, ctx) => {
      const d = await anilist(
        ctx,
        `query ($id: Int) { Character(id: $id) { id name { full native alternative } image { large } description(asHtml: false) gender age bloodType dateOfBirth { year month day } favourites siteUrl
          media(perPage: 25, sort: [POPULARITY_DESC]) { edges { characterRole node { id type format title { romaji english } } } } } }`,
        { id },
      );
      const c = d.Character;
      return {
        id: c.id,
        name: c.name,
        image: c.image?.large ?? null,
        description: clean(c.description),
        gender: c.gender ?? null,
        age: c.age ?? null,
        bloodType: c.bloodType ?? null,
        dateOfBirth: fuzzyDate(c.dateOfBirth),
        favourites: c.favourites ?? null,
        url: c.siteUrl,
        media: (c.media?.edges ?? []).map((e) => ({ role: e.characterRole, id: e.node?.id, type: e.node?.type, format: e.node?.format, title: e.node?.title })),
      };
    }),
    ep("staff/:id", "Staff", "A staff member (voice actor, director, author…).", [f.int("id", { required: true, min: 1, example: 95061 })], async ({ id }, ctx) => {
      const d = await anilist(
        ctx,
        `query ($id: Int) { Staff(id: $id) { id name { full native alternative } languageV2 image { large } description(asHtml: false) primaryOccupations gender age homeTown yearsActive
          dateOfBirth { year month day } dateOfDeath { year month day } favourites siteUrl
          staffMedia(perPage: 25, sort: [POPULARITY_DESC]) { edges { staffRole node { id type format title { romaji english } } } } } }`,
        { id },
      );
      const s = d.Staff;
      return {
        id: s.id,
        name: s.name,
        language: s.languageV2 ?? null,
        image: s.image?.large ?? null,
        description: clean(s.description),
        occupations: s.primaryOccupations ?? [],
        gender: s.gender ?? null,
        age: s.age ?? null,
        homeTown: s.homeTown ?? null,
        yearsActive: s.yearsActive ?? [],
        dateOfBirth: fuzzyDate(s.dateOfBirth),
        dateOfDeath: fuzzyDate(s.dateOfDeath),
        favourites: s.favourites ?? null,
        url: s.siteUrl,
        media: (s.staffMedia?.edges ?? []).map((e) => ({ role: e.staffRole, id: e.node?.id, type: e.node?.type, format: e.node?.format, title: e.node?.title })),
      };
    }),
  ],
};

// ---------------------------------------------------------------------------
// MyAnimeList via Jikan v4: https://docs.api.jikan.moe

const JIKAN = "https://api.jikan.moe/v4";
function jikanEntry(a) {
  if (!a) return null;
  return {
    id: a.mal_id,
    url: a.url,
    title: a.title,
    titleEnglish: a.title_english ?? null,
    titleJapanese: a.title_japanese ?? null,
    type: a.type ?? null,
    status: a.status ?? null,
    image: a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? null,
    score: a.score ?? null,
    scoredBy: a.scored_by ?? null,
    rank: a.rank ?? null,
    popularity: a.popularity ?? null,
    members: a.members ?? null,
    favorites: a.favorites ?? null,
    synopsis: a.synopsis ?? null,
    genres: names(a.genres),
    themes: names(a.themes),
    // anime
    ...(a.episodes !== undefined || a.aired
      ? {
          episodes: a.episodes ?? null,
          source: a.source ?? null,
          aired: a.aired ? { from: a.aired.from ?? null, to: a.aired.to ?? null, text: a.aired.string ?? null } : null,
          duration: a.duration ?? null,
          rating: a.rating ?? null,
          season: a.season ?? null,
          year: a.year ?? null,
          studios: names(a.studios),
          trailer: a.trailer?.url ?? null,
        }
      : {}),
    // manga
    ...(a.chapters !== undefined || a.published
      ? {
          chapters: a.chapters ?? null,
          volumes: a.volumes ?? null,
          published: a.published ? { from: a.published.from ?? null, to: a.published.to ?? null, text: a.published.string ?? null } : null,
          authors: names(a.authors),
          serializations: names(a.serializations),
        }
      : {}),
  };
}
const jikanList = (j) => ({
  page: j.pagination?.current_page ?? null,
  lastPage: j.pagination?.last_visible_page ?? null,
  hasMore: !!j.pagination?.has_next_page,
  total: j.pagination?.items?.total ?? null,
  results: (j.data ?? []).map(jikanEntry),
});

const myanimelist = {
  category: "movie",
  slug: "myanimelist",
  displayName: "MyAnimeList",
  description: "MyAnimeList anime & manga data served through Jikan v4, the open-source unofficial MAL REST API (no MAL account needed).",
  tags: ["anime", "manga", "mal", "jikan"],
  endpoints: [
    ep("anime/:id", "Anime", "Full anime record by MAL id.", [f.req("id", { pattern: "^\\d+$", example: "52991" })], async ({ id }, ctx) =>
      jikanEntry((await getJson(ctx, `${JIKAN}/anime/${id}/full`)).data),
    ),
    ep("manga/:id", "Manga", "Full manga record by MAL id.", [f.req("id", { pattern: "^\\d+$", example: "2" })], async ({ id }, ctx) =>
      jikanEntry((await getJson(ctx, `${JIKAN}/manga/${id}/full`)).data),
    ),
    ep(
      "characters/:id",
      "Characters",
      "Characters (and their voice actors) of an anime by MAL id.",
      [f.req("id", { pattern: "^\\d+$", example: "52991" }), countF("count", 25, 200)],
      async ({ id, count }, ctx) => {
        const j = await getJson(ctx, `${JIKAN}/anime/${id}/characters`);
        const list = j.data ?? [];
        return {
          animeId: Number(id),
          total: list.length,
          characters: list.slice(0, count).map((c) => ({
            id: c.character?.mal_id,
            name: c.character?.name,
            url: c.character?.url,
            image: c.character?.images?.jpg?.image_url ?? null,
            role: c.role,
            favorites: c.favorites ?? null,
            voiceActors: (c.voice_actors ?? []).map((v) => ({ id: v.person?.mal_id, name: v.person?.name, language: v.language })),
          })),
        };
      },
    ),
    ep(
      "search-anime",
      "Search Anime",
      "Search anime titles.",
      [f.req("q", { example: "frieren" }), pageF(), countF("count", 20, 25)],
      async ({ q, page, count }, ctx) => jikanList(await getJson(ctx, url(`${JIKAN}/anime`, { q, page, limit: count }))),
    ),
    ep(
      "search-manga",
      "Search Manga",
      "Search manga titles.",
      [f.req("q", { example: "berserk" }), pageF(), countF("count", 20, 25)],
      async ({ q, page, count }, ctx) => jikanList(await getJson(ctx, url(`${JIKAN}/manga`, { q, page, limit: count }))),
    ),
    ep(
      "seasonal",
      "Seasonal",
      "Anime of a season; omit year and season for the current one.",
      [f.int("year", { min: 1917, max: 2100 }), f.enm("season", ["winter", "spring", "summer", "fall"]), pageF(), countF("count", 20, 25)],
      async ({ year, season, page, count }, ctx) => {
        if (!!year !== !!season) throw new ScraperError("Provide both year and season, or neither for the current season");
        const base = year ? `${JIKAN}/seasons/${year}/${season}` : `${JIKAN}/seasons/now`;
        return { year: year ?? null, season: season ?? null, ...jikanList(await getJson(ctx, url(base, { page, limit: count }))) };
      },
    ),
    ep(
      "top",
      "Top Anime",
      "MAL top anime ranking, optionally filtered.",
      [f.enm("filter", ["airing", "upcoming", "bypopularity", "favorite"]), pageF(), countF("count", 20, 25)],
      async ({ filter, page, count }, ctx) => ({ filter: filter ?? null, ...jikanList(await getJson(ctx, url(`${JIKAN}/top/anime`, { filter, page, limit: count }))) }),
    ),
  ],
};

// ---------------------------------------------------------------------------
// iTunes Search / Lookup API: https://performance-partners.apple.com/search-api

const ITUNES = "https://itunes.apple.com";
function itItem(r) {
  return {
    kind: r.kind ?? r.wrapperType ?? null,
    wrapperType: r.wrapperType ?? null,
    trackId: r.trackId ?? null,
    trackName: r.trackName ?? null,
    artistId: r.artistId ?? null,
    artistName: r.artistName ?? null,
    collectionId: r.collectionId ?? null,
    collectionName: r.collectionName ?? null,
    genre: r.primaryGenreName ?? null,
    releaseDate: r.releaseDate ?? null,
    durationMs: r.trackTimeMillis ?? null,
    trackNumber: r.trackNumber ?? null,
    trackCount: r.trackCount ?? null,
    discNumber: r.discNumber ?? null,
    explicit: r.trackExplicitness ? r.trackExplicitness === "explicit" : r.collectionExplicitness ? r.collectionExplicitness === "explicit" : null,
    price: r.trackPrice ?? r.collectionPrice ?? null,
    currency: r.currency ?? null,
    country: r.country ?? null,
    previewUrl: r.previewUrl ?? null,
    artwork: r.artworkUrl100 ? r.artworkUrl100.replace("100x100bb", "600x600bb") : null,
    url: r.trackViewUrl ?? r.collectionViewUrl ?? r.artistLinkUrl ?? r.artistViewUrl ?? null,
  };
}
async function itunesSearch(ctx, params, page = 1, limit = 20) {
  const want = Math.min(200, page * limit);
  const j = await getJson(ctx, url(`${ITUNES}/search`, { ...params, limit: want }));
  const items = (j.results ?? []).slice((page - 1) * limit, page * limit);
  return { page, limit, count: items.length, results: items };
}
async function itunesLookup(ctx, params) {
  const j = await getJson(ctx, url(`${ITUNES}/lookup`, params));
  return j.results ?? [];
}

const itunes = {
  category: "music",
  slug: "itunes",
  displayName: "iTunes",
  description: "Search songs, albums and artists in the iTunes catalogue via Apple's public Search API.",
  tags: ["music", "itunes", "apple"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search music in the iTunes Store.",
      [f.req("query", { example: "daft punk" }), f.enm("entity", ["song", "album", "musicArtist"], { default: "song" }), countF("limit", 20, 200), countryF()],
      async ({ query, entity, limit, country }, ctx) => {
        const r = await itunesSearch(ctx, { term: query, media: "music", entity, country }, 1, limit);
        return { query, entity, count: r.count, results: r.results.map(itItem) };
      },
    ),
  ],
};

const appleMusic = {
  category: "music",
  slug: "apple-music",
  displayName: "Apple Music",
  description: "Apple Music / iTunes catalogue lookups (tracks, albums, artists) using Apple's keyless iTunes Search & Lookup API.",
  tags: ["music", "apple", "itunes"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search tracks, albums or artists.",
      [f.req("q", { example: "taylor swift" }), f.enm("type", ["track", "album", "artist"], { default: "track" }), countF("limit", 20, 200), pageF(50), countryF()],
      async ({ q, type, limit, page, country }, ctx) => {
        const entity = { track: "song", album: "album", artist: "musicArtist" }[type];
        const r = await itunesSearch(ctx, { term: q, media: "music", entity, country }, page, limit);
        return { query: q, type, page, count: r.count, results: r.results.map(itItem) };
      },
    ),
    ep("track/:id", "Track", "One track by iTunes track id.", [f.req("id", { pattern: "^\\d+$", example: "1440857781" }), countryF()], async ({ id, country }, ctx) => {
      const [t] = await itunesLookup(ctx, { id, country, entity: "song" });
      if (!t) throw new ScraperError("Track not found", { status: 404 });
      return itItem(t);
    }),
    ep("album/:id", "Album", "An album with its track list.", [f.req("id", { pattern: "^\\d+$", example: "1440857777" }), countryF()], async ({ id, country }, ctx) => {
      const rs = await itunesLookup(ctx, { id, country, entity: "song" });
      const album = rs.find((r) => r.wrapperType === "collection");
      if (!album) throw new ScraperError("Album not found", { status: 404 });
      return { ...itItem(album), copyright: album.copyright ?? null, tracks: rs.filter((r) => r.wrapperType === "track").map(itItem) };
    }),
    ep(
      "artist/:id",
      "Artist",
      "An artist with their albums.",
      [f.req("id", { pattern: "^\\d+$", example: "5468295" }), countF("limit", 25, 200), countryF()],
      async ({ id, limit, country }, ctx) => {
        const rs = await itunesLookup(ctx, { id, country, entity: "album", limit });
        const artist = rs.find((r) => r.wrapperType === "artist");
        if (!artist) throw new ScraperError("Artist not found", { status: 404 });
        return {
          id: artist.artistId,
          name: artist.artistName,
          genre: artist.primaryGenreName ?? null,
          url: artist.artistLinkUrl ?? null,
          albums: rs.filter((r) => r.wrapperType === "collection").map(itItem),
        };
      },
    ),
  ],
};

// ---------------------------------------------------------------------------
// Deezer: https://developers.deezer.com/api

const DEEZER = "https://api.deezer.com";
async function deezer(ctx, target) {
  const j = await getJson(ctx, target);
  if (j?.error) throw new ScraperError(j.error.message ?? "Deezer error", { status: j.error.code === 800 ? 404 : undefined, context: { error: j.error } });
  return j;
}
const dzArtist = (a) => (a ? { id: a.id, name: a.name, link: a.link ?? null, picture: a.picture_xl ?? a.picture_big ?? null, albums: a.nb_album ?? null, fans: a.nb_fan ?? null } : null);
const dzAlbumRef = (a) => (a ? { id: a.id, title: a.title, cover: a.cover_xl ?? a.cover_big ?? null, releaseDate: a.release_date ?? null, type: a.record_type ?? a.type ?? null, link: a.link ?? null } : null);
const dzTrack = (t) =>
  t
    ? {
        id: t.id,
        title: t.title,
        titleShort: t.title_short ?? null,
        isrc: t.isrc ?? null,
        duration: t.duration ?? null,
        rank: t.rank ?? null,
        explicit: t.explicit_lyrics ?? null,
        preview: t.preview || null,
        trackPosition: t.track_position ?? null,
        diskNumber: t.disk_number ?? null,
        releaseDate: t.release_date ?? null,
        bpm: t.bpm ?? null,
        link: t.link ?? null,
        artist: t.artist ? { id: t.artist.id, name: t.artist.name } : null,
        contributors: t.contributors ? t.contributors.map((c) => ({ id: c.id, name: c.name, role: c.role ?? null })) : undefined,
        album: t.album ? dzAlbumRef(t.album) : null,
      }
    : null;

const deezerScraper = {
  category: "music",
  slug: "deezer",
  displayName: "Deezer",
  description: "Tracks, albums, artists and playlists from Deezer's public catalogue API.",
  tags: ["music", "deezer", "streaming"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Search tracks, albums, artists or playlists.",
      [f.req("q", { example: "daft punk" }), f.enm("type", ["track", "album", "artist", "playlist"], { default: "track" }), countF("limit", 25, 100), pageF()],
      async ({ q, type, limit, page }, ctx) => {
        const path = type === "track" ? "/search" : `/search/${type}`;
        const j = await deezer(ctx, url(DEEZER + path, { q, limit, index: (page - 1) * limit }));
        const map = {
          track: dzTrack,
          album: (a) => ({ ...dzAlbumRef(a), tracks: a.nb_tracks ?? null, artist: a.artist ? { id: a.artist.id, name: a.artist.name } : null }),
          artist: dzArtist,
          playlist: (p) => ({ id: p.id, title: p.title, tracks: p.nb_tracks ?? null, picture: p.picture_xl ?? null, link: p.link ?? null, creator: p.user?.name ?? null }),
        }[type];
        return { query: q, type, page, total: j.total ?? null, hasMore: !!j.next, results: (j.data ?? []).map(map) };
      },
    ),
    ep("track/:id", "Track", "One track by Deezer id.", [f.req("id", { pattern: "^\\d+$", example: "3135556" })], async ({ id }, ctx) => dzTrack(await deezer(ctx, `${DEEZER}/track/${id}`))),
    ep("album/:id", "Album", "An album with its tracks.", [f.req("id", { pattern: "^\\d+$", example: "302127" })], async ({ id }, ctx) => {
      const a = await deezer(ctx, `${DEEZER}/album/${id}`);
      return {
        ...dzAlbumRef(a),
        upc: a.upc ?? null,
        label: a.label ?? null,
        genres: names(a.genres?.data),
        trackCount: a.nb_tracks ?? null,
        duration: a.duration ?? null,
        fans: a.fans ?? null,
        explicit: a.explicit_lyrics ?? null,
        artist: a.artist ? { id: a.artist.id, name: a.artist.name } : null,
        tracks: (a.tracks?.data ?? []).map(dzTrack),
      };
    }),
    ep(
      "artist/:id",
      "Artist",
      "Artist profile with top tracks and albums.",
      [f.req("id", { pattern: "^\\d+$", example: "27" }), countF("topLimit", 10, 100), countF("albumLimit", 25, 100)],
      async ({ id, topLimit, albumLimit }, ctx) => {
        const [a, top, albums] = await Promise.all([
          deezer(ctx, `${DEEZER}/artist/${id}`),
          deezer(ctx, url(`${DEEZER}/artist/${id}/top`, { limit: topLimit })),
          deezer(ctx, url(`${DEEZER}/artist/${id}/albums`, { limit: albumLimit })),
        ]);
        return { ...dzArtist(a), topTracks: (top.data ?? []).map(dzTrack), albumList: (albums.data ?? []).map(dzAlbumRef) };
      },
    ),
  ],
};

// ---------------------------------------------------------------------------
// MusicBrainz: https://musicbrainz.org/doc/MusicBrainz_API

const MB = "https://musicbrainz.org/ws/2";
const mbCredit = (ac) => (ac ?? []).map((c) => ({ id: c.artist?.id ?? null, name: c.name ?? c.artist?.name, joinphrase: c.joinphrase || undefined }));
const MB_MAP = {
  recording: (r) => ({
    id: r.id,
    score: r.score ?? null,
    title: r.title,
    lengthMs: r.length ?? null,
    disambiguation: r.disambiguation || null,
    firstReleaseDate: r["first-release-date"] ?? null,
    artists: mbCredit(r["artist-credit"]),
    isrcs: r.isrcs ?? [],
    releases: (r.releases ?? []).slice(0, 10).map((x) => ({ id: x.id, title: x.title, date: x.date ?? null, country: x.country ?? null })),
  }),
  artist: (a) => ({
    id: a.id,
    score: a.score ?? null,
    name: a.name,
    sortName: a["sort-name"] ?? null,
    type: a.type ?? null,
    gender: a.gender ?? null,
    country: a.country ?? null,
    area: a.area?.name ?? null,
    disambiguation: a.disambiguation || null,
    lifeSpan: a["life-span"] ?? null,
    tags: names(a.tags),
  }),
  release: (r) => ({
    id: r.id,
    score: r.score ?? null,
    title: r.title,
    status: r.status ?? null,
    date: r.date ?? null,
    country: r.country ?? null,
    barcode: r.barcode || null,
    trackCount: r["track-count"] ?? null,
    artists: mbCredit(r["artist-credit"]),
    labels: (r["label-info"] ?? []).map((l) => ({ name: l.label?.name ?? null, catalogNumber: l["catalog-number"] ?? null })),
    releaseGroup: r["release-group"] ? { id: r["release-group"].id, type: r["release-group"]["primary-type"] ?? null } : null,
  }),
};
const MB_PLURAL = { recording: "recordings", artist: "artists", release: "releases" };

const musicbrainz = {
  category: "music",
  slug: "musicbrainz",
  displayName: "MusicBrainz",
  description: "Open music encyclopedia: search and look up recordings, artists and releases via the MusicBrainz web service.",
  tags: ["music", "metadata", "open-data"],
  endpoints: [
    ep(
      "search",
      "Search",
      "Lucene-style search across recordings, artists or releases.",
      [f.req("query", { example: "bohemian rhapsody" }), f.enm("entity", ["recording", "artist", "release"], { default: "recording" }), countF("limit", 25, 100), f.int("offset", { default: 0, min: 0 })],
      async ({ query, entity, limit, offset }, ctx) => {
        const j = await getJson(ctx, url(`${MB}/${entity}`, { query, limit, offset, fmt: "json" }));
        return { query, entity, total: j.count ?? null, offset: j.offset ?? offset, results: (j[MB_PLURAL[entity]] ?? []).map(MB_MAP[entity]) };
      },
    ),
    ep(
      "lookup",
      "Lookup",
      "Fetch one recording, artist or release by MBID.",
      [f.req("mbid", { pattern: "^[0-9a-fA-F-]{36}$", example: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d" }), f.enm("entity", ["recording", "artist", "release"], { default: "artist" })],
      async ({ mbid, entity }, ctx) => {
        const inc = { recording: "artist-credits+releases+isrcs", artist: "tags+aliases", release: "artist-credits+labels+recordings" }[entity];
        const j = await getJson(ctx, url(`${MB}/${entity}/${mbid}`, { inc, fmt: "json" }));
        const out = MB_MAP[entity](j);
        if (entity === "release") out.media = (j.media ?? []).map((m) => ({ format: m.format ?? null, tracks: (m.tracks ?? []).map((t) => ({ position: t.position, title: t.title, lengthMs: t.length ?? null })) }));
        if (entity === "artist") out.aliases = names(j.aliases);
        return out;
      },
      { cacheTtl: 86400 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// PokeAPI: https://pokeapi.co/docs/v2

const pokeapi = {
  category: "games",
  slug: "pokeapi",
  displayName: "PokeAPI",
  description: "Pokémon stats, types, abilities and sprites from the open PokeAPI.",
  tags: ["pokemon", "games"],
  endpoints: [
    ep("pokemon", "Pokémon", "Look up a Pokémon by name or national dex number.", [f.req("name", { example: "pikachu" })], async ({ name }, ctx) => {
      const p = await getJson(ctx, `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(String(name).trim().toLowerCase())}`);
      return {
        id: p.id,
        name: p.name,
        height: p.height,
        weight: p.weight,
        baseExperience: p.base_experience ?? null,
        types: (p.types ?? []).sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
        abilities: (p.abilities ?? []).map((a) => ({ name: a.ability.name, hidden: !!a.is_hidden })),
        stats: Object.fromEntries((p.stats ?? []).map((s) => [s.stat.name, s.base_stat])),
        moves: (p.moves ?? []).map((m) => m.move.name),
        sprites: {
          front: p.sprites?.front_default ?? null,
          shiny: p.sprites?.front_shiny ?? null,
          artwork: p.sprites?.other?.["official-artwork"]?.front_default ?? null,
        },
      };
    }, { cacheTtl: 86400 }),
  ],
};

// ---------------------------------------------------------------------------
// CheapShark: https://apidocs.cheapshark.com

const CS = "https://www.cheapshark.com/api/1.0";
const cheapshark = {
  category: "games",
  slug: "cheapshark",
  displayName: "CheapShark Deals",
  description: "PC game price deals across digital stores, from the CheapShark API.",
  tags: ["games", "deals", "prices", "steam"],
  endpoints: [
    ep(
      "deals",
      "Deals",
      "Current game deals, optionally filtered by store, title or max price.",
      [f.str("storeID", { example: "1", description: "Store id (see stores endpoint); 1 = Steam" }), f.num("upperPrice", { min: 0 }), countF("limit", 20, 60), f.str("title"), f.int("page", { default: 1, min: 1, max: 50 })],
      async ({ storeID, upperPrice, limit, title, page }, ctx) => {
        const j = await getJson(ctx, url(`${CS}/deals`, { storeID, upperPrice, pageSize: limit, title, pageNumber: page - 1 }));
        return {
          count: j.length,
          deals: j.map((d) => ({
            dealID: d.dealID,
            title: d.title,
            gameID: d.gameID,
            storeID: d.storeID,
            salePrice: num(d.salePrice),
            normalPrice: num(d.normalPrice),
            savings: d.savings != null ? Math.round(Number(d.savings) * 100) / 100 : null,
            isOnSale: d.isOnSale === "1",
            metacriticScore: num(d.metacriticScore),
            steamRating: d.steamRatingText ? { text: d.steamRatingText, percent: num(d.steamRatingPercent), count: num(d.steamRatingCount) } : null,
            steamAppID: d.steamAppID ?? null,
            releaseDate: d.releaseDate ? new Date(d.releaseDate * 1000).toISOString() : null,
            dealRating: num(d.dealRating),
            thumb: d.thumb ?? null,
            url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.dealID)}`,
          })),
        };
      },
      { cacheTtl: 900 },
    ),
    ep("games", "Search Games", "Find games by title with their cheapest known price.", [f.req("title", { example: "batman" }), countF("limit", 20, 60)], async ({ title, limit }, ctx) => {
      const j = await getJson(ctx, url(`${CS}/games`, { title, limit }));
      return { count: j.length, games: j.map((g) => ({ gameID: g.gameID, title: g.external, steamAppID: g.steamAppID ?? null, cheapest: num(g.cheapest), cheapestDealID: g.cheapestDealID, thumb: g.thumb ?? null })) };
    }, { cacheTtl: 900 }),
    ep("stores", "Stores", "Stores tracked by CheapShark.", [], async (_p, ctx) => {
      const j = await getJson(ctx, `${CS}/stores`);
      return { count: j.length, stores: j.map((s) => ({ storeID: s.storeID, name: s.storeName, active: s.isActive === 1, logo: s.images?.logo ? `https://www.cheapshark.com${s.images.logo}` : null })) };
    }, { cacheTtl: 86400 }),
  ],
};

// ---------------------------------------------------------------------------
// TheMealDB: https://www.themealdb.com/api.php

const mealBase = () => `https://www.themealdb.com/api/json/v1/${env("THEMEALDB_KEY") || "1"}`;
function meal(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = m[`strIngredient${i}`]?.trim();
    if (name) ingredients.push({ name, measure: m[`strMeasure${i}`]?.trim() || null });
  }
  return {
    id: m.idMeal,
    name: m.strMeal,
    category: m.strCategory ?? null,
    area: m.strArea ?? null,
    instructions: m.strInstructions ?? null,
    thumbnail: m.strMealThumb ?? null,
    tags: m.strTags ? m.strTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    youtube: m.strYoutube || null,
    source: m.strSource || null,
    ingredients,
  };
}
const themealdb = {
  category: "food",
  slug: "themealdb",
  displayName: "TheMealDB",
  description: "Recipes with ingredients and instructions from TheMealDB (uses the public test key unless THEMEALDB_KEY is set).",
  tags: ["food", "recipes", "cooking"],
  endpoints: [
    ep("search", "Search", "Search meals by name.", [f.req("query", { example: "arrabiata" })], async ({ query }, ctx) => {
      const j = await getJson(ctx, url(`${mealBase()}/search.php`, { s: query }));
      const meals = (j?.meals ?? []).map(meal);
      return { query, count: meals.length, meals };
    }, { cacheTtl: 86400 }),
    ep("lookup", "Lookup", "A meal by TheMealDB id.", [f.req("mealId", { pattern: "^\\d+$", example: "52771" })], async ({ mealId }, ctx) => {
      const j = await getJson(ctx, url(`${mealBase()}/lookup.php`, { i: mealId }));
      if (!j?.meals?.length) throw new ScraperError("Meal not found", { status: 404 });
      return meal(j.meals[0]);
    }, { cacheTtl: 86400 }),
    ep("random", "Random", "One random meal.", [], async (_p, ctx) => meal((await getJson(ctx, `${mealBase()}/random.php`)).meals[0]), { cacheTtl: 0, bulkEnabled: false }),
    ep("categories", "Categories", "All meal categories.", [], async (_p, ctx) => {
      const j = await getJson(ctx, `${mealBase()}/categories.php`);
      return { categories: (j.categories ?? []).map((c) => ({ id: c.idCategory, name: c.strCategory, thumbnail: c.strCategoryThumb, description: c.strCategoryDescription })) };
    }, { cacheTtl: 86400 }),
  ],
};

// ---------------------------------------------------------------------------
// Open Food Facts: https://openfoodfacts.github.io/openfoodfacts-server/api/

const OFF = "https://world.openfoodfacts.org";
const OFF_FIELDS = "code,product_name,generic_name,brands,quantity,categories,categories_tags,labels,countries,image_url,image_front_url,ingredients_text,allergens_tags,traces_tags,nutriscore_grade,nova_group,ecoscore_grade,nutriments,serving_size,stores";
function offProduct(p, code) {
  const n = p.nutriments ?? {};
  return {
    barcode: p.code ?? code ?? null,
    name: p.product_name || null,
    genericName: p.generic_name || null,
    brands: p.brands || null,
    quantity: p.quantity || null,
    servingSize: p.serving_size || null,
    categories: p.categories || null,
    labels: p.labels || null,
    countries: p.countries || null,
    stores: p.stores || null,
    image: p.image_front_url ?? p.image_url ?? null,
    ingredients: p.ingredients_text || null,
    allergens: (p.allergens_tags ?? []).map((t) => t.replace(/^\w+:/, "")),
    traces: (p.traces_tags ?? []).map((t) => t.replace(/^\w+:/, "")),
    nutriscore: p.nutriscore_grade ?? null,
    novaGroup: p.nova_group ?? null,
    ecoscore: p.ecoscore_grade ?? null,
    nutrimentsPer100g: {
      energyKcal: num(n["energy-kcal_100g"]),
      fat: num(n.fat_100g),
      saturatedFat: num(n["saturated-fat_100g"]),
      carbohydrates: num(n.carbohydrates_100g),
      sugars: num(n.sugars_100g),
      fiber: num(n.fiber_100g),
      proteins: num(n.proteins_100g),
      salt: num(n.salt_100g),
      sodium: num(n.sodium_100g),
    },
    url: `${OFF}/product/${p.code ?? code}`,
  };
}
const openfoodfacts = {
  category: "food",
  slug: "openfoodfacts",
  displayName: "Open Food Facts",
  description: "Crowd-sourced packaged-food database: ingredients, allergens, Nutri-Score and nutrition facts by barcode.",
  tags: ["food", "nutrition", "barcode", "open-data"],
  endpoints: [
    ep("product", "Product", "Product facts by EAN/UPC barcode.", [f.req("barcode", { pattern: "^\\d{6,14}$", example: "3017624010701" })], async ({ barcode }, ctx) => {
      const j = await getJson(ctx, url(`${OFF}/api/v2/product/${barcode}.json`, { fields: OFF_FIELDS }));
      if (!j || j.status === 0 || !j.product) throw new ScraperError("Product not found", { status: 404 });
      return offProduct(j.product, barcode);
    }, { cacheTtl: 86400 }),
    ep(
      "search",
      "Search",
      "Full-text product search.",
      [f.req("query", { example: "nutella" }), pageF(), countF("count", 20, 100)],
      async ({ query, page, count }, ctx) => {
        const j = await getJson(ctx, url(`${OFF}/cgi/search.pl`, { search_terms: query, search_simple: 1, action: "process", json: 1, page, page_size: count, fields: OFF_FIELDS }));
        return { query, page, total: num(j.count), products: (j.products ?? []).map((p) => offProduct(p)) };
      },
    ),
  ],
};

// ---------------------------------------------------------------------------
// WHO Global Health Observatory OData: https://www.who.int/data/gho/info/gho-odata-api

const GHO = "https://ghoapi.azureedge.net/api";
const odq = (s) => `'${String(s).replace(/'/g, "''")}'`;
function odata(path, filter) {
  return filter ? `${GHO}/${path}?$filter=${encodeURIComponent(filter)}` : `${GHO}/${path}`;
}
const ghoDim = (d) => ({ code: d.Code, title: d.Title, parentCode: d.ParentCode || null, parentTitle: d.ParentTitle || null, parentDimension: d.ParentDimension || null });

const who = {
  category: "health",
  slug: "who",
  displayName: "WHO GHO",
  description: "World Health Organization Global Health Observatory statistics (indicators, dimensions, country data) via its OData API.",
  tags: ["health", "who", "statistics", "open-data"],
  endpoints: [
    ep(
      "indicators",
      "Indicators",
      "List or search GHO indicator codes.",
      [f.str("search", { example: "life expectancy" }), f.str("code", { example: "WHOSIS_000001" }), pageF(500), countF("limit", 50, 500)],
      async ({ search, code, page, limit }, ctx) => {
        const filter = code ? `IndicatorCode eq ${odq(code)}` : search ? `contains(IndicatorName,${odq(search)})` : null;
        const j = await getJson(ctx, odata("Indicator", filter));
        const list = (j.value ?? []).map((i) => ({ code: i.IndicatorCode, name: i.IndicatorName, language: i.Language ?? null }));
        const p = paginate(list, page, limit);
        return { page, limit, total: p.total, hasMore: p.hasMore, indicators: p.items };
      },
      { cacheTtl: 86400 },
    ),
    ep("dimensions", "Dimensions", "All GHO dimensions (COUNTRY, SEX, AGEGROUP, …).", [], async (_p, ctx) => {
      const j = await getJson(ctx, `${GHO}/Dimension`);
      return { dimensions: (j.value ?? []).map((d) => ({ code: d.Code, title: d.Title })) };
    }, { cacheTtl: 86400 }),
    ep("dimension-values/:dimension", "Dimension Values", "Allowed values of one dimension.", [f.req("dimension", { pattern: "^[A-Za-z0-9_]+$", example: "SEX" })], async ({ dimension }, ctx) => {
      const j = await getJson(ctx, `${GHO}/DIMENSION/${dimension.toUpperCase()}/DimensionValues`);
      return { dimension: dimension.toUpperCase(), values: (j.value ?? []).map(ghoDim) };
    }, { cacheTtl: 86400 }),
    ep("countries", "Countries", "WHO country codes, optionally limited to one WHO region (AFR, AMR, SEAR, EUR, EMR, WPR).", [f.str("region", { example: "SEAR" })], async ({ region }, ctx) => {
      const j = await getJson(ctx, `${GHO}/DIMENSION/COUNTRY/DimensionValues`);
      let list = (j.value ?? []).map(ghoDim);
      if (region) list = list.filter((c) => c.parentCode?.toUpperCase() === region.toUpperCase());
      return { region: region ?? null, count: list.length, countries: list };
    }, { cacheTtl: 86400 }),
    ep("regions", "Regions", "WHO regions.", [], async (_p, ctx) => {
      const j = await getJson(ctx, `${GHO}/DIMENSION/REGION/DimensionValues`);
      return { regions: (j.value ?? []).map(ghoDim) };
    }, { cacheTtl: 86400 }),
    ep(
      "indicator-data/:indicator",
      "Indicator Data",
      "Observations of one indicator, filterable by place, year range and dimensions.",
      [
        f.req("indicator", { pattern: "^[A-Za-z0-9_]+$", example: "WHOSIS_000001" }),
        f.str("country", { description: "ISO3 country code", example: "IDN" }),
        f.str("region", { description: "WHO region code", example: "SEAR" }),
        f.enm("spatialDimType", ["COUNTRY", "REGION", "WORLDBANKINCOMEGROUP", "GLOBAL"]),
        f.int("year"),
        f.int("yearFrom"),
        f.int("yearTo"),
        f.str("dim1", { description: "Dim1 value, e.g. SEX_BTSX", example: "SEX_BTSX" }),
        f.str("dim2"),
        f.str("dim3"),
        f.enm("orderBy", ["year", "value", "country", "id"], { default: "year" }),
        f.enm("order", ["asc", "desc"], { default: "desc" }),
        pageF(1000),
        countF("limit", 100, 1000),
      ],
      async (p, ctx) => {
        const cond = [];
        if (p.country) cond.push(`SpatialDim eq ${odq(p.country.toUpperCase())}`);
        if (p.region) cond.push(`SpatialDim eq ${odq(p.region.toUpperCase())}`);
        if (p.spatialDimType) cond.push(`SpatialDimType eq ${odq(p.spatialDimType)}`);
        if (p.year !== undefined) cond.push(`TimeDim eq ${p.year}`);
        if (p.yearFrom !== undefined) cond.push(`TimeDim ge ${p.yearFrom}`);
        if (p.yearTo !== undefined) cond.push(`TimeDim le ${p.yearTo}`);
        for (const d of ["dim1", "dim2", "dim3"]) if (p[d]) cond.push(`${d[0].toUpperCase()}${d.slice(1)} eq ${odq(p[d])}`);
        const j = await getJson(ctx, odata(p.indicator.toUpperCase(), cond.join(" and ") || null));
        const rows = (j.value ?? []).map((r) => ({
          id: r.Id,
          spatialDimType: r.SpatialDimType ?? null,
          spatialDim: r.SpatialDim ?? null,
          parentLocation: r.ParentLocation ?? null,
          year: r.TimeDim ?? null,
          dim1Type: r.Dim1Type ?? null,
          dim1: r.Dim1 ?? null,
          dim2Type: r.Dim2Type ?? null,
          dim2: r.Dim2 ?? null,
          dim3Type: r.Dim3Type ?? null,
          dim3: r.Dim3 ?? null,
          value: r.NumericValue ?? null,
          low: r.Low ?? null,
          high: r.High ?? null,
          display: r.Value ?? null,
          comments: r.Comments ?? null,
          date: r.Date ?? null,
        }));
        const key = { year: "year", value: "value", country: "spatialDim", id: "id" }[p.orderBy];
        const dir = p.order === "asc" ? 1 : -1;
        rows.sort((a, b) => {
          const x = a[key], y = b[key];
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x > y ? 1 : x < y ? -1 : 0) * dir;
        });
        const pg = paginate(rows, p.page, p.limit);
        return { indicator: p.indicator.toUpperCase(), page: p.page, limit: p.limit, total: pg.total, hasMore: pg.hasMore, data: pg.items };
      },
      { cacheTtl: 21600 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// NLM Clinical Table Search Service: https://clinicaltables.nlm.nih.gov

const CTSS = "https://clinicaltables.nlm.nih.gov";
const CT_COMMON = () => [
  f.req("terms", { description: "Search text (prefix match)" }),
  pageF(1000),
  countF("limit", 20, 500),
  f.str("fields", { description: "Display fields (df), comma separated" }),
  f.str("extraFields", { description: "Extra fields returned per row (ef), comma separated" }),
  f.str("searchFields", { description: "Fields searched (sf), comma separated" }),
  f.str("codeField", { description: "Field used as the code (cf)" }),
  f.str("filter", { description: "Extra Elasticsearch-style query (q), e.g. field:value" }),
];
// table → { slug, title, example, extra fields, defaults }
const CT_TABLES = {
  conditions: { slug: "conditions", title: "Conditions", ex: "gastro", desc: "Medical conditions (consumer + clinical names, ICD-10 mapping)." },
  cytogenetic_locs: { slug: "cytogenetic-locations", title: "Cytogenetic Locations", ex: "1p36", desc: "Human chromosome cytogenetic band locations." },
  dbvar: { slug: "dbvar", title: "dbVar", ex: "nssv", desc: "NCBI dbVar structural variants." },
  disease_names: { slug: "disease-names", title: "Disease Names", ex: "alzh", desc: "Disease names from NCBI MedGen/GTR." },
  drug_ingredients: { slug: "drug-ingredients", title: "Drug Ingredients", ex: "acetam", desc: "Active drug ingredients (RxNorm)." },
  rxterms: { slug: "drugs", title: "Drugs (RxTerms)", ex: "lipitor", desc: "Prescribable drug names with strengths/forms (RxTerms).", defaults: { extraFields: "STRENGTHS_AND_FORMS,RXCUIS" } },
  ncbi_genes: { slug: "genes", title: "Genes", ex: "brca", desc: "Human genes from NCBI Gene." },
  hcpcs: { slug: "hcpcs", title: "HCPCS", ex: "wheelchair", desc: "HCPCS Level II procedure/supply codes." },
  hpo: { slug: "hpo", title: "HPO", ex: "seiz", desc: "Human Phenotype Ontology terms." },
  icd10cm: { slug: "icd10", title: "ICD-10-CM", ex: "tuberc", desc: "ICD-10-CM diagnosis codes.", defaults: { searchFields: "code,name", fields: "code,name" } },
  icd11_codes: { slug: "icd11", title: "ICD-11", ex: "malaria", desc: "WHO ICD-11 codes." },
  icd9cm_dx: { slug: "icd9-dx", title: "ICD-9-CM Diagnoses", ex: "diabet", desc: "ICD-9-CM diagnosis codes." },
  icd9cm_sg: { slug: "icd9-sg", title: "ICD-9-CM Procedures", ex: "biopsy", desc: "ICD-9-CM surgical procedure codes." },
  loinc_items: { slug: "lab-codes", title: "LOINC", ex: "glucose", desc: "LOINC lab tests, survey questions, forms and panels.", loinc: true },
  procedures: { slug: "procedures", title: "Procedures", ex: "appendect", desc: "Consumer-friendly medical procedure names." },
  npi_idv: { slug: "providers-individual", title: "NPI Individuals", ex: "john smith", desc: "US healthcare providers (individuals) from the NPI registry." },
  npi_org: { slug: "providers-organisation", title: "NPI Organizations", ex: "mayo clinic", desc: "US healthcare provider organisations from the NPI registry." },
  refseqs: { slug: "refseqs", title: "RefSeqs", ex: "NM_000", desc: "NCBI RefSeq transcripts." },
  snps: { slug: "snps", title: "SNPs", ex: "rs7412", desc: "dbSNP variants." },
  star_alleles: { slug: "star-alleles", title: "Star Alleles", ex: "CYP2D6", desc: "Pharmacogene star alleles (PharmVar)." },
  ucum: { slug: "units", title: "UCUM Units", ex: "mg/dL", desc: "UCUM units of measure." },
};
async function ctSearch(ctx, table, p) {
  const d = CT_TABLES[table]?.defaults ?? {};
  const limit = p.limit ?? 20;
  const params = {
    terms: p.terms,
    count: limit,
    offset: ((p.page ?? 1) - 1) * limit,
    df: p.fields ?? d.fields,
    ef: p.extraFields ?? d.extraFields,
    sf: p.searchFields ?? d.searchFields,
    cf: p.codeField ?? d.codeField,
    q: p.filter,
  };
  if (table === "loinc_items") Object.assign(params, { type: p.type, available: p.available, excludeCopyrighted: p.excludeCopyrighted });
  const j = await getJson(ctx, url(`${CTSS}/api/${table}/v3/search`, params));
  if (!Array.isArray(j)) throw new ScraperError("Unexpected Clinical Tables response");
  const [total, codes = [], extra, display = [], codeSystems] = j;
  const extraKeys = extra ? Object.keys(extra) : [];
  return {
    table,
    terms: p.terms,
    page: p.page ?? 1,
    limit,
    total,
    hasMore: params.offset + codes.length < total,
    results: codes.map((code, i) => ({
      code,
      display: display[i] ?? [],
      ...(extraKeys.length ? { extra: Object.fromEntries(extraKeys.map((k) => [k, extra[k]?.[i] ?? null])) } : {}),
      ...(codeSystems ? { codeSystem: codeSystems[i] ?? null } : {}),
    })),
  };
}
const LOINC_FIELDS = () => [f.enm("type", ["question", "form", "panel"]), f.enm("available", ["true", "false"]), f.enm("excludeCopyrighted", ["true", "false"])];

const clinicalTables = {
  category: "health",
  slug: "clinical-tables",
  displayName: "Clinical Tables",
  description: "NLM Clinical Table Search Service: autocomplete-style lookups over ICD, LOINC, RxTerms, NPI, genes, variants and more.",
  tags: ["health", "medical-codes", "icd10", "loinc", "nlm"],
  endpoints: [
    ...Object.entries(CT_TABLES).map(([table, t]) =>
      ep(t.slug, t.title, t.desc, [...CT_COMMON().map((fl) => (fl.name === "terms" ? { ...fl, example: t.ex } : fl)), ...(t.loinc ? LOINC_FIELDS() : [])], (p, ctx) => ctSearch(ctx, table, p), { cacheTtl: 86400 }),
    ),
    ep(
      "search",
      "Search Any Table",
      "Search any supported Clinical Tables table by its API name.",
      [f.enm("table", Object.keys(CT_TABLES), { required: true, example: "icd10cm" }), ...CT_COMMON(), ...LOINC_FIELDS()],
      (p, ctx) => ctSearch(ctx, p.table, p),
      { cacheTtl: 86400 },
    ),
    ep("form-definition", "LOINC Form Definition", "LHC-Forms definition (questions, answers, structure) for a LOINC panel/form.", [f.req("loincNum", { pattern: "^\\d{1,8}-\\d$", example: "34565-2" })], async ({ loincNum }, ctx) => {
      const j = await getJson(ctx, url(`${CTSS}/loinc_form_definitions`, { loinc_num: loincNum }));
      if (!j || (typeof j === "object" && !Object.keys(j).length)) throw new ScraperError("Form definition not found", { status: 404 });
      return j;
    }, { cacheTtl: 86400 }),
  ],
};

// ---------------------------------------------------------------------------
// MedlinePlus: web service, MedlinePlus Connect, Genetics JSON

const MLP_CS = {
  icd10cm: "2.16.840.1.113883.6.90",
  icd9cm: "2.16.840.1.113883.6.103",
  snomed: "2.16.840.1.113883.6.96",
  rxcui: "2.16.840.1.113883.6.88",
  ndc: "2.16.840.1.113883.6.69",
  loinc: "2.16.840.1.113883.6.1",
  cpt: "2.16.840.1.113883.6.12",
};
function parseMlpSearch(xml) {
  const tag = (name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];
  const docs = [...xml.matchAll(/<document\s([^>]*)>([\s\S]*?)<\/document>/g)].map((m) => {
    const rank = /rank="(\d+)"/.exec(m[1])?.[1];
    const href = /url="([^"]+)"/.exec(m[1])?.[1];
    const content = {};
    for (const c of m[2].matchAll(/<content name="([^"]+)">([\s\S]*?)<\/content>/g)) {
      const v = stripHtml(decodeEntities(c[2]));
      if (content[c[1]] === undefined) content[c[1]] = v;
      else content[c[1]] = [].concat(content[c[1]], v);
    }
    const arr = (v) => (v === undefined ? [] : [].concat(v));
    return {
      rank: num(rank),
      url: href ? decodeEntities(href) : null,
      title: content.title ?? null,
      altTitles: arr(content.altTitle),
      organization: content.organizationName ?? null,
      summary: content.FullSummary ?? null,
      snippet: content.snippet ?? null,
      groups: arr(content.groupName),
      mesh: arr(content.mesh),
    };
  });
  return { total: num(tag("count")), documents: docs };
}
function genetics(j, kind) {
  const texts = (j["text-list"] ?? []).map((t) => t.text ?? t).filter(Boolean);
  return {
    kind,
    name: j.name ?? null,
    symbol: j["gene-symbol"] ?? undefined,
    url: j["ghr-page"] ?? null,
    sections: texts.map((t) => ({ role: t["text-role"] ?? null, text: stripHtml(t.html ?? t.text ?? "") })),
    synonyms: (j["synonym-list"] ?? []).map((s) => s.synonym ?? s).filter((x) => typeof x === "string"),
    relatedGenes: (j["related-gene-list"] ?? []).map((g) => g["related-gene"] ?? g).map((g) => ({ symbol: g["gene-symbol"] ?? null, url: g["ghr-page"] ?? null })),
    relatedConditions: (j["related-health-condition-list"] ?? []).map((c) => c["related-health-condition"] ?? c).map((c) => ({ name: c.name ?? null, url: c["ghr-page"] ?? null })),
    dbKeys: (j["db-key-list"] ?? []).map((k) => k["db-key"] ?? k),
    raw: j,
  };
}
const medlineplus = {
  category: "health",
  slug: "medlineplus",
  displayName: "MedlinePlus",
  description: "Consumer health information from the US National Library of Medicine: health topics, code-to-info lookups and genetics summaries.",
  tags: ["health", "medical", "nlm", "genetics"],
  endpoints: [
    ep(
      "search-topics",
      "Search Health Topics",
      "Search MedlinePlus health topics in English or Spanish.",
      [f.req("term", { example: "diabetes" }), f.enm("language", ["en", "es"], { default: "en" }), pageF(), countF("limit", 10, 100), f.enm("detail", ["brief", "topic", "all"], { default: "brief" })],
      async ({ term, language, page, limit, detail }, ctx) => {
        const xml = await getText(ctx, url("https://wsearch.nlm.nih.gov/ws/query", { db: language === "es" ? "healthTopicsSpanish" : "healthTopics", term, retstart: (page - 1) * limit, retmax: limit, rettype: detail }));
        const r = parseMlpSearch(xml);
        return { term, language, page, limit, total: r.total, results: r.documents };
      },
      { cacheTtl: 86400 },
    ),
    ep(
      "lookup",
      "Code Lookup",
      "MedlinePlus Connect: patient-friendly info for a diagnosis, drug or lab code.",
      [f.enm("codeSystem", Object.keys(MLP_CS), { required: true, example: "icd10cm" }), f.req("code", { example: "E11.9" }), f.enm("language", ["en", "es"], { default: "en" })],
      async ({ codeSystem, code, language }, ctx) => {
        const j = await getJson(
          ctx,
          url("https://connect.medlineplus.gov/service", {
            "mainSearchCriteria.v.cs": MLP_CS[codeSystem],
            "mainSearchCriteria.v.c": code,
            "informationRecipient.languageCode.c": language,
            knowledgeResponseType: "application/json",
          }),
        );
        const entries = [].concat(j?.feed?.entry ?? []);
        return {
          codeSystem,
          code,
          language,
          title: j?.feed?.title?._value ?? null,
          results: entries.map((e) => ({
            title: e.title?._value ?? null,
            url: [].concat(e.link ?? [])[0]?.href ?? null,
            summary: clean(e.summary?._value),
          })),
        };
      },
      { cacheTtl: 86400 },
    ),
    ep("genetics-condition", "Genetic Condition", "MedlinePlus Genetics summary of a condition (by URL slug).", [f.req("slug", { pattern: "^[a-z0-9-]+$", example: "cystic-fibrosis" })], async ({ slug }, ctx) =>
      genetics(await getJson(ctx, `https://medlineplus.gov/download/genetics/condition/${slug}.json`), "condition"),
    { cacheTtl: 86400 }),
    ep("genetics-gene", "Gene", "MedlinePlus Genetics summary of a gene (by symbol).", [f.req("symbol", { pattern: "^[A-Za-z0-9-]+$", example: "BRCA1" })], async ({ symbol }, ctx) =>
      genetics(await getJson(ctx, `https://medlineplus.gov/download/genetics/gene/${symbol.toLowerCase()}.json`), "gene"),
    { cacheTtl: 86400 }),
  ],
};

// ---------------------------------------------------------------------------
// Flathub: https://flathub.org/api/v2/docs

const FLATHUB = "https://flathub.org/api/v2";
const flatHit = (h) => ({
  id: h.app_id ?? h.id ?? null,
  name: h.name ?? null,
  summary: h.summary ?? null,
  icon: h.icon ?? null,
  developer: h.developer_name ?? null,
  license: h.project_license ?? null,
  categories: h.main_categories ?? h.categories ?? null,
  installsLastMonth: h.installs_last_month ?? null,
  verified: h.verification_verified ?? null,
  updatedAt: h.updated_at ?? null,
  url: h.app_id ? `https://flathub.org/apps/${h.app_id}` : null,
});
const flathub = {
  category: "application",
  slug: "flathub",
  displayName: "Flathub",
  description: "Linux Flatpak apps on Flathub: AppStream metadata, curated collections, search and install stats.",
  tags: ["linux", "flatpak", "apps"],
  endpoints: [
    ep("app", "App", "AppStream metadata of an app by its Flatpak id.", [f.req("id", { example: "org.mozilla.firefox" })], async ({ id }, ctx) => {
      const a = await getJson(ctx, `${FLATHUB}/appstream/${encodeURIComponent(id)}`);
      if (!a) throw new ScraperError("App not found", { status: 404 });
      return {
        id: a.id ?? id,
        name: a.name ?? null,
        summary: a.summary ?? null,
        description: clean(a.description),
        developer: a.developer_name ?? null,
        license: a.project_license ?? null,
        icon: a.icon ?? null,
        categories: a.categories ?? [],
        keywords: a.keywords ?? [],
        urls: a.urls ?? null,
        screenshots: (a.screenshots ?? []).map((s) => s.sizes?.["1248x702"] ?? s.sizes?.["752x423"] ?? Object.values(s.sizes ?? {})[0] ?? null).filter(Boolean),
        releases: (a.releases ?? []).slice(0, 10).map((r) => ({ version: r.version, date: r.timestamp ? new Date(Number(r.timestamp) * 1000).toISOString() : null, description: clean(r.description) })),
        url: `https://flathub.org/apps/${a.id ?? id}`,
      };
    }),
    ep(
      "collection",
      "Collection",
      "Curated Flathub lists (popular, trending, new, updated, verified, mobile).",
      [f.enm("collection", ["popular", "recently-added", "recently-updated", "trending", "verified", "mobile"], { default: "popular" }), pageF(), countF("count", 25, 250)],
      async ({ collection, page, count }, ctx) => {
        const j = await getJson(ctx, url(`${FLATHUB}/collection/${collection}`, { page, per_page: count }));
        const hits = Array.isArray(j) ? j : j.hits ?? [];
        return { collection, page: j.page ?? page, totalPages: j.totalPages ?? null, total: j.totalHits ?? null, apps: hits.map(flatHit) };
      },
    ),
    ep(
      "search",
      "Search",
      "Search Flathub apps.",
      [f.req("query", { example: "image editor" }), pageF(), countF("count", 25, 250)],
      async ({ query, page, count }, ctx) => {
        const j = await postJson(ctx, `${FLATHUB}/search`, { query, page, hits_per_page: count });
        return { query, page: j.page ?? page, totalPages: j.totalPages ?? null, total: j.totalHits ?? j.estimatedTotalHits ?? null, apps: (j.hits ?? []).map(flatHit) };
      },
    ),
    ep("stats", "Install Stats", "Install statistics of an app.", [f.req("id", { example: "org.mozilla.firefox" }), f.int("days", { default: 30, min: 1, max: 3650, description: "How many daily points to return" })], async ({ id, days }, ctx) => {
      const j = await getJson(ctx, `${FLATHUB}/stats/${encodeURIComponent(id)}`);
      const perDay = Object.entries(j.installs_per_day ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-days).map(([date, installs]) => ({ date, installs }));
      return {
        id,
        installsTotal: j.installs_total ?? null,
        installsLastMonth: j.installs_last_month ?? null,
        installsLast7Days: j.installs_last_7_days ?? null,
        perCountry: j.installs_per_country ?? null,
        perDay,
      };
    }),
  ],
};

// ---------------------------------------------------------------------------
// Snapcraft store API: https://api.snapcraft.io/docs/

const SNAP = "https://api.snapcraft.io/v2/snaps";
const SNAP_HEADERS = { "Snap-Device-Series": "16" };
const snapMeta = (s = {}) => ({
  title: s.title ?? null,
  summary: s.summary ?? null,
  description: s.description ?? null,
  publisher: s.publisher ? { id: s.publisher.id ?? null, name: s.publisher["display-name"] ?? null, username: s.publisher.username ?? null, validation: s.publisher.validation ?? null } : null,
  license: s.license ?? null,
  icon: (s.media ?? []).find((m) => m.type === "icon")?.url ?? null,
  screenshots: (s.media ?? []).filter((m) => m.type === "screenshot").map((m) => m.url),
  categories: names(s.categories),
  website: s.website ?? null,
  storeUrl: s["store-url"] ?? null,
});
const snapcraft = {
  category: "application",
  slug: "snapcraft",
  displayName: "Snapcraft",
  description: "Snap packages from the Snap Store: metadata, publisher and channel/version map.",
  tags: ["linux", "snap", "ubuntu", "apps"],
  endpoints: [
    ep("snap", "Snap", "Details and channel map of a snap by name.", [f.req("id", { pattern: "^[a-z0-9-]+$", example: "firefox" }), f.str("architecture", { example: "amd64" })], async ({ id, architecture }, ctx) => {
      const j = await getJson(
        ctx,
        url(`${SNAP}/info/${id}`, { fields: "title,summary,description,publisher,media,license,links,store-url,website,categories,contact", architecture }),
        { headers: SNAP_HEADERS },
      );
      let channels = (j["channel-map"] ?? []).map((c) => ({
        channel: c.channel?.name ?? null,
        track: c.channel?.track ?? null,
        risk: c.channel?.risk ?? null,
        architecture: c.channel?.architecture ?? null,
        version: c.version ?? null,
        revision: c.revision ?? null,
        releasedAt: c.channel?.["released-at"] ?? null,
        size: c.download?.size ?? null,
      }));
      if (architecture) channels = channels.filter((c) => !c.architecture || c.architecture === architecture);
      return { name: j.name, snapId: j["snap-id"] ?? null, defaultTrack: j["default-track"] ?? null, ...snapMeta(j.snap), channels };
    }),
    ep("search", "Search", "Search the Snap Store.", [f.req("query", { example: "vlc" }), pageF(), countF("count", 20, 100)], async ({ query, page, count }, ctx) => {
      const j = await getJson(ctx, url(`${SNAP}/find`, { q: query, fields: "title,summary,publisher,media,license,store-url,categories,version" }), { headers: SNAP_HEADERS });
      const all = (j.results ?? []).map((r) => ({ name: r.name, snapId: r["snap-id"] ?? null, version: r.revision?.version ?? r.snap?.version ?? null, ...snapMeta(r.snap) }));
      const p = paginate(all, page, count);
      return { query, page, total: p.total, hasMore: p.hasMore, results: p.items };
    }),
  ],
};

// ---------------------------------------------------------------------------
// addons.mozilla.org API v5: https://mozilla.github.io/addons-server/topics/api/

const AMO = "https://addons.mozilla.org/api/v5";
const tr = (v) => (v == null ? null : typeof v === "string" ? v : v["en-US"] ?? v[v._default] ?? Object.values(v)[0] ?? null);
const amoAddon = (a) => ({
  id: a.id,
  guid: a.guid ?? null,
  slug: a.slug ?? null,
  type: a.type ?? null,
  name: tr(a.name),
  summary: clean(tr(a.summary)),
  description: a.description !== undefined ? clean(tr(a.description)) : undefined,
  icon: a.icon_url ?? null,
  url: a.url ?? null,
  homepage: tr(a.homepage?.url ?? a.homepage) ?? null,
  authors: (a.authors ?? []).map((x) => ({ id: x.id, name: x.name, username: x.username ?? null, url: x.url ?? null })),
  users: a.average_daily_users ?? null,
  weeklyDownloads: a.weekly_downloads ?? null,
  rating: a.ratings ? { average: a.ratings.average, bayesian: a.ratings.bayesian_average ?? null, count: a.ratings.count, textCount: a.ratings.text_count ?? null } : null,
  version: a.current_version?.version ?? null,
  license: tr(a.current_version?.license?.name) ?? null,
  categories: a.categories ?? null,
  tags: a.tags ?? [],
  created: a.created ?? null,
  lastUpdated: a.last_updated ?? null,
  isExperimental: a.is_experimental ?? null,
  promoted: a.promoted ?? null,
});
const amoList = (j, page, mapper) => ({ total: j.count ?? null, page, hasMore: !!j.next, results: (j.results ?? []).map(mapper) });
const firefoxAddons = {
  category: "application",
  slug: "firefox-addons",
  displayName: "Firefox Add-ons",
  description: "Firefox extensions and themes from addons.mozilla.org: details, search, versions, reviews and authors.",
  tags: ["firefox", "extensions", "browser", "mozilla"],
  endpoints: [
    ep("addon", "Add-on", "Add-on details by numeric id, slug or GUID.", [f.req("id", { example: "ublock-origin" }), f.str("lang", { default: "en-US" })], async ({ id, lang }, ctx) =>
      amoAddon(await getJson(ctx, url(`${AMO}/addons/addon/${encodeURIComponent(id)}/`, { lang }))),
    ),
    ep(
      "search",
      "Search",
      "Search add-ons.",
      [
        f.req("query", { example: "password manager" }),
        f.enm("app", ["firefox", "android"], { default: "firefox" }),
        f.enm("type", ["extension", "theme", "dictionary", "language", "statictheme"]),
        f.enm("sort", ["relevance", "users", "rating", "created", "updated", "downloads", "hotness", "random"]),
        f.str("lang", { default: "en-US" }),
        pageF(),
        countF("count", 25, 50),
      ],
      async ({ query, app, type, sort, lang, page, count }, ctx) =>
        ({ query, ...amoList(await getJson(ctx, url(`${AMO}/addons/search/`, { q: query, app, type, sort, lang, page, page_size: count })), page, amoAddon) }),
    ),
    ep(
      "versions",
      "Versions",
      "Published versions of an add-on.",
      [f.req("id", { example: "ublock-origin" }), f.str("lang", { default: "en-US" }), pageF(), countF("count", 25, 50)],
      async ({ id, lang, page, count }, ctx) => {
        const j = await getJson(ctx, url(`${AMO}/addons/addon/${encodeURIComponent(id)}/versions/`, { lang, page, page_size: count }));
        return {
          addon: id,
          ...amoList(j, page, (v) => ({
            id: v.id,
            version: v.version,
            channel: v.channel ?? null,
            releaseNotes: clean(tr(v.release_notes)),
            license: tr(v.license?.name) ?? null,
            compatibility: v.compatibility ?? null,
            created: v.file?.created ?? v.created ?? null,
            size: v.file?.size ?? null,
            downloadUrl: v.file?.url ?? null,
          })),
        };
      },
    ),
    ep(
      "reviews",
      "Reviews",
      "User ratings and reviews of an add-on.",
      [f.req("id", { example: "ublock-origin" }), f.int("score", { min: 1, max: 5 }), f.str("lang", { default: "en-US" }), pageF(), countF("count", 25, 50)],
      async ({ id, score, lang, page, count }, ctx) => {
        const j = await getJson(ctx, url(`${AMO}/ratings/rating/`, { addon: id, score, lang, page, page_size: count }));
        return {
          addon: id,
          ...amoList(j, page, (r) => ({
            id: r.id,
            score: r.score,
            body: r.body ?? null,
            created: r.created ?? null,
            user: r.user?.name ?? null,
            version: r.version?.version ?? null,
            isDeveloperReply: !!r.is_developer_reply,
            reply: r.reply ? { body: r.reply.body, created: r.reply.created } : null,
          })),
        };
      },
      { cacheTtl: 1800 },
    ),
    ep("author", "Author", "Public profile of an add-on developer plus their add-ons.", [f.req("developer", { description: "User id or username", example: "gorhill" }), f.str("lang", { default: "en-US" })], async ({ developer, lang }, ctx) => {
      const u = await getJson(ctx, url(`${AMO}/accounts/account/${encodeURIComponent(developer)}/`, { lang }));
      const addons = await getJson(ctx, url(`${AMO}/addons/search/`, { author: u.id, lang, page_size: 50 }));
      return {
        id: u.id,
        name: u.name ?? null,
        username: u.username ?? null,
        url: u.url ?? null,
        picture: u.picture_url ?? null,
        biography: clean(u.biography),
        homepage: u.homepage ?? null,
        location: u.location ?? null,
        occupation: u.occupation ?? null,
        averageAddonRating: u.average_addon_rating ?? null,
        addonCount: u.num_addons_listed ?? null,
        created: u.created ?? null,
        addons: (addons.results ?? []).map(amoAddon),
      };
    }),
  ],
};

// ---------------------------------------------------------------------------
// App Store: iTunes Search/Lookup, customer-review RSS, chart RSS

const APP_ENTITIES = ["software", "iPadSoftware", "macSoftware", "tvSoftware"];
const appItem = (r) => ({
  id: r.trackId,
  bundleId: r.bundleId ?? null,
  name: r.trackName,
  developer: r.artistName ?? r.sellerName ?? null,
  developerId: r.artistId ?? null,
  price: r.price ?? null,
  formattedPrice: r.formattedPrice ?? null,
  currency: r.currency ?? null,
  rating: r.averageUserRating ?? null,
  ratingCount: r.userRatingCount ?? null,
  version: r.version ?? null,
  releaseDate: r.releaseDate ?? null,
  currentVersionReleaseDate: r.currentVersionReleaseDate ?? null,
  releaseNotes: r.releaseNotes ?? null,
  genres: r.genres ?? [],
  primaryGenre: r.primaryGenreName ?? null,
  contentRating: r.contentAdvisoryRating ?? r.trackContentRating ?? null,
  minimumOsVersion: r.minimumOsVersion ?? null,
  sizeBytes: num(r.fileSizeBytes),
  languages: r.languageCodesISO2A ?? [],
  description: r.description ?? null,
  icon: r.artworkUrl512 ?? r.artworkUrl100 ?? null,
  screenshots: r.screenshotUrls ?? [],
  ipadScreenshots: r.ipadScreenshotUrls ?? [],
  url: r.trackViewUrl ?? null,
  sellerUrl: r.sellerUrl ?? null,
});
const lbl = (x) => x?.label ?? null;
const CHART_FEEDS = ["topfreeapplications", "toppaidapplications", "topgrossingapplications", "topfreeipadapplications", "toppaidipadapplications", "topgrossingipadapplications", "newapplications", "newfreeapplications", "newpaidapplications"];
const appStore = {
  category: "application",
  slug: "app-store",
  displayName: "App Store",
  description: "Apple App Store apps: details, search, developer catalogues, customer reviews and top charts via Apple's public lookup and RSS feeds.",
  tags: ["ios", "apps", "apple", "app-store"],
  endpoints: [
    ep("app", "App", "App details by App Store id or bundle id.", [f.str("id", { pattern: "^\\d+$", example: "284882215" }), f.str("bundleId", { example: "com.facebook.Facebook" }), countryF()], async ({ id, bundleId, country }, ctx) => {
      if (!id && !bundleId) throw new ScraperError("Provide id or bundleId");
      const [r] = await itunesLookup(ctx, { id, bundleId: id ? undefined : bundleId, country });
      if (!r) throw new ScraperError("App not found", { status: 404 });
      return appItem(r);
    }),
    ep(
      "search",
      "Search",
      "Search the App Store.",
      [f.req("query", { example: "photo editor" }), countryF(), f.enm("entity", APP_ENTITIES, { default: "software" }), pageF(20), countF("count", 25, 200)],
      async ({ query, country, entity, page, count }, ctx) => {
        const r = await itunesSearch(ctx, { term: query, country, entity, media: "software" }, page, count);
        return { query, country, page, count: r.count, results: r.results.map(appItem) };
      },
    ),
    ep(
      "developer",
      "Developer",
      "All apps published by a developer (artist) id.",
      [f.req("developerId", { pattern: "^\\d+$", example: "284882218" }), countryF(), f.enm("entity", APP_ENTITIES, { default: "software" }), countF("count", 50, 200)],
      async ({ developerId, country, entity, count }, ctx) => {
        const rs = await itunesLookup(ctx, { id: developerId, country, entity, limit: count });
        const dev = rs.find((r) => r.wrapperType === "artist");
        if (!dev) throw new ScraperError("Developer not found", { status: 404 });
        return { id: dev.artistId, name: dev.artistName, url: dev.artistLinkUrl ?? null, apps: rs.filter((r) => r.wrapperType === "software").map(appItem) };
      },
    ),
    ep(
      "reviews",
      "Reviews",
      "Customer reviews from Apple's review RSS feed (up to 10 pages of 50).",
      [f.req("id", { pattern: "^\\d+$", example: "284882215" }), countryF(), f.enm("sort", ["mostrecent", "mosthelpful"], { default: "mostrecent" }), f.int("page", { default: 1, min: 1, max: 10 })],
      async ({ id, country, sort, page }, ctx) => {
        const j = await getJson(ctx, `${ITUNES}/${country.toLowerCase()}/rss/customerreviews/page=${page}/id=${id}/sortby=${sort}/json`);
        const entries = [].concat(j?.feed?.entry ?? []).filter((e) => e?.["im:rating"]);
        return {
          appId: id,
          country,
          page,
          sort,
          count: entries.length,
          reviews: entries.map((e) => ({
            id: lbl(e.id),
            author: lbl(e.author?.name),
            rating: num(lbl(e["im:rating"])),
            title: lbl(e.title),
            content: lbl(e.content),
            version: lbl(e["im:version"]),
            voteSum: num(lbl(e["im:voteSum"])),
            voteCount: num(lbl(e["im:voteCount"])),
            updated: lbl(e.updated),
          })),
        };
      },
      { cacheTtl: 1800 },
    ),
    ep(
      "charts",
      "Top Charts",
      "App Store top charts (free, paid, grossing, iPad, new) per country, optionally per genre id.",
      [f.enm("feed", CHART_FEEDS, { default: "topfreeapplications" }), countryF(), f.str("genre", { pattern: "^\\d+$", description: "App Store genre id, e.g. 6014 = Games", example: "6014" }), countF("count", 50, 200)],
      async ({ feed, country, genre, count }, ctx) => {
        const cc = country.toLowerCase();
        // The current Apple marketing-tools feed covers the plain free/paid iPhone charts.
        const modern = { topfreeapplications: "top-free", toppaidapplications: "top-paid" }[feed];
        if (modern && !genre && count <= 100) {
          const size = [10, 25, 50, 100].find((n) => n >= count);
          const j = await getJson(ctx, `https://rss.applemarketingtools.com/api/v2/${cc}/apps/${modern}/${size}/apps.json`);
          const results = (j?.feed?.results ?? []).slice(0, count);
          return {
            feed,
            country,
            genre: null,
            updated: j?.feed?.updated ?? null,
            apps: results.map((a, i) => ({ rank: i + 1, id: a.id, name: a.name, developer: a.artistName ?? null, developerId: a.artistId ?? null, icon: a.artworkUrl100 ?? null, genres: names(a.genres), releaseDate: a.releaseDate ?? null, price: null, url: a.url ?? null })),
          };
        }
        const j = await getJson(ctx, `${ITUNES}/${cc}/rss/${feed}/limit=${count}${genre ? `/genre=${genre}` : ""}/json`);
        const entries = [].concat(j?.feed?.entry ?? []);
        return {
          feed,
          country,
          genre: genre ?? null,
          updated: lbl(j?.feed?.updated),
          apps: entries.map((e, i) => ({
            rank: i + 1,
            id: e.id?.attributes?.["im:id"] ?? null,
            bundleId: e.id?.attributes?.["im:bundleId"] ?? null,
            name: lbl(e["im:name"]),
            developer: lbl(e["im:artist"]),
            icon: [].concat(e["im:image"] ?? []).at(-1)?.label ?? null,
            genres: e.category?.attributes?.label ? [e.category.attributes.label] : [],
            releaseDate: e["im:releaseDate"]?.label ?? null,
            price: num(e["im:price"]?.attributes?.amount),
            url: lbl(e.id),
          })),
        };
      },
      { cacheTtl: 1800 },
    ),
  ],
};

// ---------------------------------------------------------------------------
// Mail.tm / Mail.gw: documented Hydra REST APIs (https://docs.mail.tm)

const hydra = (j) => (Array.isArray(j) ? j : j?.["hydra:member"] ?? []);
function tempMail(slug, displayName, base, site) {
  const auth = (token) => ({ headers: { authorization: `Bearer ${token}` } });
  async function tokenFor(ctx, address, { token, password }) {
    if (token) return token;
    if (!password) throw new ScraperError("Provide the token (or password) returned by the create endpoint");
    return (await postJson(ctx, `${base}/token`, { address, password })).token;
  }
  const msg = (m) => ({
    id: m.id,
    from: m.from ?? null,
    to: m.to ?? [],
    subject: m.subject ?? null,
    intro: m.intro ?? null,
    seen: !!m.seen,
    hasAttachments: !!m.hasAttachments,
    size: m.size ?? null,
    createdAt: m.createdAt ?? null,
  });
  const fullMsg = (m) => ({
    ...msg(m),
    cc: m.cc ?? [],
    text: m.text ?? null,
    html: Array.isArray(m.html) ? m.html.join("") : m.html ?? null,
    attachments: (m.attachments ?? []).map((a) => ({ id: a.id, filename: a.filename, contentType: a.contentType, size: a.size })),
  });
  return {
    category: "temp-mail",
    slug,
    displayName,
    description: `Disposable inboxes on ${site}: create a throwaway address and read the mail it receives.`,
    tags: ["email", "temp-mail", "disposable"],
    endpoints: [
      ep(
        "create",
        "Create Inbox",
        "Create a random mailbox. Keep the returned token (or password) to read the inbox.",
        [f.str("domain", { description: "Specific domain to use; defaults to the first active one" })],
        async ({ domain }, ctx) => {
          const domains = hydra(await getJson(ctx, `${base}/domains`)).filter((d) => d.isActive !== false && !d.isPrivate);
          if (!domains.length) throw new ScraperError("No mail domains available");
          const chosen = domain ? domains.find((d) => d.domain === domain) : domains[0];
          if (!chosen) throw new ScraperError(`Domain ${domain} is not available`, { context: { available: domains.map((d) => d.domain) } });
          const address = `${randomString(12)}@${chosen.domain}`;
          const password = randomString(16, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789");
          const account = await postJson(ctx, `${base}/accounts`, { address, password });
          const { token } = await postJson(ctx, `${base}/token`, { address, password });
          return { id: account?.id ?? null, address, password, token, domain: chosen.domain, createdAt: account?.createdAt ?? null, provider: site };
        },
        { cacheTtl: 0, bulkEnabled: false },
      ),
      ep(
        "inbox/:address",
        "Inbox",
        "List messages of a mailbox created with the create endpoint.",
        [
          f.req("address", { pattern: "^[^@\\s]+@[^@\\s]+$", example: "abc123@example.com" }),
          f.str("token", { description: "Bearer token returned by create" }),
          f.str("password", { description: "Mailbox password (used to obtain a token if none given)" }),
          f.bool("full", { default: false, description: "Also fetch the body of each message (max 10)" }),
          f.int("page", { default: 1, min: 1, max: 100 }),
        ],
        async ({ address, token, password, full, page }, ctx) => {
          const t = await tokenFor(ctx, address, { token, password });
          const list = hydra(await getJson(ctx, url(`${base}/messages`, { page }), auth(t)));
          let messages = list.map(msg);
          if (full) {
            const bodies = await Promise.all(list.slice(0, 10).map((m) => getJson(ctx, `${base}/messages/${m.id}`, auth(t))));
            messages = [...bodies.map(fullMsg), ...messages.slice(10)];
          }
          return { address, page, count: messages.length, messages };
        },
        { cacheTtl: 0, bulkEnabled: false },
      ),
      ep(
        "message/:id",
        "Message",
        "Read one message (text + HTML body).",
        [f.req("id"), f.req("address", { pattern: "^[^@\\s]+@[^@\\s]+$" }), f.str("token"), f.str("password")],
        async ({ id, address, token, password }, ctx) => {
          const t = await tokenFor(ctx, address, { token, password });
          return fullMsg(await getJson(ctx, `${base}/messages/${encodeURIComponent(id)}`, auth(t)));
        },
        { cacheTtl: 0, bulkEnabled: false },
      ),
    ],
  };
}

// ---------------------------------------------------------------------------

export default [
  tvmaze,
  anilistScraper,
  myanimelist,
  itunes,
  appleMusic,
  deezerScraper,
  musicbrainz,
  pokeapi,
  cheapshark,
  themealdb,
  openfoodfacts,
  who,
  clinicalTables,
  medlineplus,
  flathub,
  snapcraft,
  firefoxAddons,
  appStore,
  tempMail("mail-tm", "Mail.tm", "https://api.mail.tm", "mail.tm"),
  tempMail("mail-gw", "Mail.gw", "https://api.mail.gw", "mail.gw"),
];
