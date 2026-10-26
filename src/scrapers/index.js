// Every live scraper module. Endpoints listed in the catalog seed but not
// implemented here are served by the upstream adapter or shown as "planned".
import finance from "./live/finance.js";
import indonesia from "./live/indonesia.js";
import news from "./live/news.js";
import researchDev from "./live/research-dev.js";
import mediaApps from "./live/media-apps.js";
import devtools from "./live/devtools.js";

export default [...indonesia, ...finance, ...news, ...researchDev, ...mediaApps, ...devtools];
