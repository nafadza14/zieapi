// Register every scraper module here. See ./_template.js for the shape.
import devTools from "./dev-tools.js";
import indonesia from "./indonesia.js";
import finance from "./finance.js";
import webTools from "./web-tools.js";

export default [...devTools, ...indonesia, ...finance, ...webTools];
