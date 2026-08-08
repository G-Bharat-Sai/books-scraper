# Books to Scrape — polite scraper

A small, polite scraping pipeline: downloads the first 3 catalogue pages of *Books to Scrape*, visits all 60 book detail pages, and turns the raw HTML into clean, schema-validated JSON — without hammering the site, and without crashing on a broken page.

## Target classification

- **Site:** `https://books.toscrape.com`
- **Why this site is appropriate to scrape:** Books to Scrape (and its parent site, toscrape.com) explicitly describes itself as a sandbox built for people to practice web scraping on. It exists specifically for this purpose — not a real business whose data I'd be scraping without consent.
- **Scope:** the first 3 catalogue pages only (`page-1.html` through `page-3.html`), and the 60 individual book detail pages linked from them. Nothing beyond that.
- **Data collected:** for each book — title, product URL, price, availability, star rating, description, and provenance (which catalogue page it came from, and when it was fetched).
- **robots.txt check:** requested `https://books.toscrape.com/robots.txt` once — the site returned `404 Not Found`. No robots file exists at all. A missing file is not the same as permission; it simply means there's no explicit rule to follow either way, so I fall back on this being a purpose-built practice sandbox as my actual basis for scraping it, plus the politeness rules I follow regardless (see below).

I will not reuse this code on another site without checking its rules and terms first.

## Ethics note

This scraper only touches a public practice sandbox built for exactly this purpose. In general, and for any future scraping work: use an official API when one exists rather than scraping; never bypass logins, paywalls, CAPTCHAs, or other access blocks — those are explicit signals that the data isn't meant to be accessed that way; collect only the fields actually needed, not everything reachable; and always identify yourself honestly via the User-Agent header rather than pretending to be a browser.

## How to run it

Requires **Node.js 20+**.

```powershell
git clone https://github.com/G-Bharat-Sai/books-scraper.git
cd books-scraper
npm install
node src/index.js
```

This produces:
- `output/books.json` — the 60 validated, clean records
- `output/errors.json` — any records that failed schema validation, with a reason
- `output/run-report.json` — honest numbers about what happened during the run

Re-running the same command is safe — cached pages are read from `cache/` instead of re-fetched, and `books.json` still ends up with exactly 60 records, not 120 (idempotent).

## Record schema

Every record in `books.json` is validated against this Zod schema before being stored — anything that fails goes to `errors.json` with a reason instead:

```javascript
const BookSchema = z.object({
    title: z.string().min(1),
    product_url: z.string().url(),
    price_text: z.string().min(1),
    price_gbp: z.number().positive(),
    availability_text: z.string().min(1),
    rating_text: z.string().min(1),
    description: z.string().nullable(),
    source_page: z.string().url(),
    fetched_at: z.string().datetime()
});
```

- `price_text` and `price_gbp` are kept side by side — the original scraped string and the clean, sortable number, so nothing is silently discarded during normalization.
- `description` is explicitly nullable, not just optional — some books genuinely have no description on the page, and the scraper stores `null` rather than inventing text.
- `product_url` is the canonical identity for each record — records are collected in a `Map` keyed on this URL, so if the same book URL were ever discovered twice, it would only be stored once.

## Politeness rules

Every real request (not cache hits) follows these rules:

- **User-Agent:** `FlyRankInternshipA9/1.0 (+https://github.com/G-Bharat-Sai/books-scraper)` — identifies the scraper honestly and links back to this repo, so a site owner who notices it in their logs can find out who's making the requests.
- **Timeout:** 8 seconds per request, enforced via `AbortController` — a hung request gives up rather than waiting forever.
- **Delay:** at least 500ms between real requests to the site. This delay is skipped entirely for cache hits, since a cached page never leaves this computer.
- **Status check:** only an HTTP `200` is treated as a successful fetch. Anything else is a failure, handled per the retry rules below.
- **Caching:** every fetched page is saved to `cache/` and read from there on subsequent runs — the site is only ever hit once per unique URL across the whole development process.
- **Selective retry:** a timeout or `5xx` server error is retried once after a 1.5 second pause (both are potentially transient). A `404` (page doesn't exist) or `403` (site explicitly refused) is never retried — retrying either would either accomplish nothing or actively be rude to the site.

## Sample run report

```json
{
  "start_time": "2026-08-08T20:41:08.522Z",
  "duration_ms": 240,
  "catalogue_pages_fetched": 3,
  "catalogue_page_cache_hits": 3,
  "book_pages_discovered": 60,
  "book_page_cache_hits": 60,
  "valid_records": 60,
  "invalid_records": 0,
  "failed_pages": 0
}
```

(This particular run read entirely from cache, hence the very short duration and 100% cache hit rate — a fresh run against the live site with no cache takes roughly 30-40 seconds, respecting the 500ms delay across ~63 real requests.)

**Failure handling was verified separately**, not just assumed: one deliberately fake book URL (`this-book-does-not-exist_9999`) was temporarily injected into the link list, confirmed to fail with a `404`, get logged and skipped without retry (correct — 404s are never retried), and the run still finished with `valid_records: 60` and `failed_pages: 1`. That test code was removed before this submission — it is not part of the committed scraper.

## Why this assignment needed no browser

Every field this scraper collects — title, price, availability, rating, description — is already present in the raw HTML the server sends back on the very first request. There's no client-side JavaScript building these values after page load, so a headless browser (Puppeteer, Playwright) would add real cost — a full browser process, more memory, slower page loads — for zero benefit over a plain HTTP request. A browser only earns its cost when the data isn't in the initial HTML at all, which isn't the case here.

## One honest limitation

The scraper assumes Books to Scrape's HTML structure (class names like `.product_pod`, `.price_color`, `.star-rating`) stays stable. If the site's markup changed — a redesign, a class rename — the selectors in `parseCataloguePage` and `parseBookPage` would silently return empty strings rather than throwing a clear error, and those bad values would then get caught by schema validation (e.g. an empty `title` failing `min(1)`) rather than by a more specific, earlier check. A more robust version would validate the raw HTML structure itself before attempting extraction, not just the final record shape.

## How the code is organized

Everything lives in `src/index.js`, in the order the pipeline actually runs:

1. **Fetch + cache** (`fetchWithCache`, `fetchWithRetry`, `fetchOnce`) — the politeness layer: user-agent, timeout, delay, retry policy, and disk caching, used for every request regardless of whether it's a catalogue page or a book page.
2. **Discover** (`discoverAllBookLinks`, `parseCataloguePage`) — follows the catalogue's own pagination, capped at 3 pages, collecting deduplicated absolute book URLs.
3. **Extract** (`parseBookPage`) — pulls the eight raw fields from a single book page, scoped to the product info box rather than the whole document.
4. **Normalize** (`normalizeRecord`) — turns `price_text` into `price_gbp`.
5. **Validate** (`BookSchema`, in `main`) — every normalized record is checked against the schema; only passing records reach `books.json`.
6. **Store + report** (in `main`) — writes `books.json`, `errors.json`, and `run-report.json`.