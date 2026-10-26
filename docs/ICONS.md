# Source logos

Each scraper card shows the logo of the website it reads from.

## Where the logos come from
1. `src/catalog/domains.js` maps every scraper (`category:slug`) to its source website.
2. On 26 Oct 2026 each site's own favicon was collected with the in-app browser through public favicon services (favicone.com, icon.horse, unavatar.io). Placeholder images those services return for unknown sites were filtered out. Two sites (blibli.com, dealls.com) were read directly from their homepages.
3. A few icons that were too small were replaced with vector icons from [simple-icons](https://simpleicons.org) (CC0).
4. Every icon was resized to 128 × 128 PNG (or kept as SVG) in `public/assets/sources/`, and the mapping is in `src/catalog/icons.js`.

Result: 268 of 296 scrapers have a logo. The rest get a two-letter monogram. That covers 21 sources whose sites block automated access or had no usable favicon, plus 7 Apizie utilities with no external source.

## Changing a logo
Admin → Scrapers → **Set logo**. Paste an `https://` image URL, or leave it empty to upload a file (resized to 128 px in the browser). Type `reset` to go back to the default. Overrides are stored in the database and win over the bundled file.

## Trademarks
Logos belong to their owners and are shown only to identify where the data comes from. Remove any logo on request from its owner.

## Global API providers
Logos for the 1,383 global APIs come from each provider's favicon (favicone.com, collected with the in-app browser on 26 Oct 2026, placeholders removed). Mapping: `src/catalog/icons-global.js`. 884 of 1,383 global APIs have a logo; the rest show a monogram.
