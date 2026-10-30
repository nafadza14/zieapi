// Every live scraper module. Endpoints listed in the catalog seed but not
// implemented here are served by the upstream adapter or shown as "planned".
import official from "./live/official.js";
import finance from "./live/finance.js";
import indonesia from "./live/indonesia.js";
import news from "./live/news.js";
import researchDev from "./live/research-dev.js";
import mediaApps from "./live/media-apps.js";
import devtools from "./live/devtools.js";
import publicApis from "./live/public-apis.js";
import publicApis2 from "./live/public-apis-2.js";
import publicApis3 from "./live/public-apis-3.js";
import globalNews from "./live/news-global.js";
import dataPortals from "./live/data-portals.js";

export default [...official, ...finance, ...indonesia, ...news, ...researchDev, ...mediaApps, ...devtools, ...publicApis, ...publicApis2, ...publicApis3, ...globalNews, ...dataPortals];
