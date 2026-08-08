\# Books to Scrape — polite scraper



A small, polite scraping pipeline: downloads the first 3 catalogue pages of \*Books to Scrape\*, visits all 60 book detail pages, and turns the raw HTML into clean, schema-validated JSON — without hammering the site, and without crashing on a broken page.



\## Target classification



\- \*\*Site:\*\* `https://books.toscrape.com`

\- \*\*Why this site is appropriate to scrape:\*\* Books to Scrape (and its parent site, toscrape.com) explicitly describes itself as a sandbox built for people to practice web scraping on. It exists specifically for this purpose — not a real business whose data I'd be scraping without consent.

\- \*\*Scope:\*\* the first 3 catalogue pages only (`page-1.html` through `page-3.html`), and the 60 individual book detail pages linked from them. Nothing beyond that.

\- \*\*Data collected:\*\* for each book — title, product URL, price, availability, star rating, description, and provenance (which catalogue page it came from, and when it was fetched).

\- \*\*robots.txt check:\*\* requested `https://books.toscrape.com/robots.txt` once — the site returned `404 Not Found`. No robots file exists at all. A missing file is not the same as permission; it simply means there's no explicit rule to follow either way, so I fall back on this being a purpose-built practice sandbox as my actual basis for scraping it, plus the politeness rules I follow regardless (see below).



I will not reuse this code on another site without checking its rules and terms first.

