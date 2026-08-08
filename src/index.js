const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { z } = require("zod");

const USER_AGENT = "FlyRankInternshipA9/1.0 (+https://github.com/G-Bharat-Sai/books-scraper)";
const CACHE_DIR = path.join(__dirname, "..", "cache");
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const TIMEOUT_MS = 8000;
const DELAY_MS = 500;
const MAX_CATALOGUE_PAGES = 3;
const RETRY_DELAY_MS = 1500;

for (const dir of [CACHE_DIR, OUTPUT_DIR]) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheFilenameForBookUrl(url) {
    const slug = url.split("/").filter(Boolean).slice(-2)[0];
    return `book-${slug}.html`;
}

class FetchError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

async function fetchOnce(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timeoutId);
        throw new FetchError(`Timeout fetching ${url}`, "timeout");
    }
    clearTimeout(timeoutId);

    if (response.status !== 200) {
        throw new FetchError(`Fetch failed for ${url}: status ${response.status}`, response.status);
    }

    return response.text();
}

async function fetchWithRetry(url) {
    try {
        return await fetchOnce(url);
    } catch (err) {
        const isRetryable =
            err.status === "timeout" || (typeof err.status === "number" && err.status >= 500);

        if (!isRetryable) {
            throw err;
        }

        console.log(`RETRY      ${url}  (after: ${err.message})`);
        await sleep(RETRY_DELAY_MS);
        return await fetchOnce(url);
    }
}

async function fetchWithCache(url, cacheFilename) {
    const cachePath = path.join(CACHE_DIR, cacheFilename);

    if (fs.existsSync(cachePath)) {
        const html = fs.readFileSync(cachePath, "utf-8");
        console.log(`CACHE HIT  ${url}  (${html.length} bytes)`);
        return { html, wasCacheHit: true };
    }

    await sleep(DELAY_MS);

    const html = await fetchWithRetry(url);
    fs.writeFileSync(cachePath, html, "utf-8");
    console.log(`FETCH      ${url}  (${html.length} bytes)`);

    return { html, wasCacheHit: false };
}

function parseCataloguePage(html, pageUrl) {
    const $ = cheerio.load(html);

    const bookLinks = [];
    $("article.product_pod h3 a").each((_, el) => {
        const href = $(el).attr("href");
        const absoluteUrl = new URL(href, pageUrl).href;
        bookLinks.push(absoluteUrl);
    });

    const nextHref = $("li.next a").attr("href");
    const nextPageUrl = nextHref ? new URL(nextHref, pageUrl).href : null;

    return { bookLinks, nextPageUrl };
}

async function discoverAllBookLinks() {
    let pageUrl = "https://books.toscrape.com/catalogue/page-1.html";
    let pageNumber = 1;
    const allLinks = new Map();
    let cacheHits = 0;

    while (pageUrl && pageNumber <= MAX_CATALOGUE_PAGES) {
        const { html, wasCacheHit } = await fetchWithCache(pageUrl, `catalogue-page-${pageNumber}.html`);
        if (wasCacheHit) cacheHits++;

        const { bookLinks, nextPageUrl } = parseCataloguePage(html, pageUrl);

        for (const link of bookLinks) {
            if (!allLinks.has(link)) {
                allLinks.set(link, pageUrl);
            }
        }

        pageUrl = nextPageUrl;
        pageNumber++;
    }


    return {
        cataloguePages: pageNumber - 1,
        bookLinks: allLinks,
        cataloguePageCacheHits: cacheHits
    };
}

function parseBookPage(html, bookUrl, sourcePageUrl) {
    const $ = cheerio.load(html);
    const product = $(".product_main");

    const title = product.find("h1").text().trim();
    const priceText = product.find(".price_color").first().text().trim();
    const availabilityText = product.find(".availability").text().trim();

    const ratingClass = product.find(".star-rating").attr("class") || "";
    const ratingText = ratingClass.replace("star-rating", "").trim();

    const descriptionEl = $("#product_description").next("p");
    const description = descriptionEl.length ? descriptionEl.text().trim() : null;

    return {
        title,
        product_url: bookUrl,
        price_text: priceText,
        availability_text: availabilityText,
        rating_text: ratingText,
        description,
        source_page: sourcePageUrl,
        fetched_at: new Date().toISOString()
    };
}

function normalizeRecord(raw) {
    const numericPrice = parseFloat(raw.price_text.replace(/[^0-9.]/g, ""));
    return { ...raw, price_gbp: numericPrice };
}

async function main() {
    const startTime = Date.now();

    const { cataloguePages, bookLinks, cataloguePageCacheHits } = await discoverAllBookLinks();

    console.log(`catalogue_pages=${cataloguePages}`);
    console.log(`discovered=${bookLinks.size}`);

    const validRecords = new Map();
    const errors = [];
    let bookPageCacheHits = 0;
    let failedPages = 0;

    for (const [bookUrl, sourcePageUrl] of bookLinks) {
        try {
            const cacheFilename = cacheFilenameForBookUrl(bookUrl);
            const { html, wasCacheHit } = await fetchWithCache(bookUrl, cacheFilename);
            if (wasCacheHit) bookPageCacheHits++;

            const raw = parseBookPage(html, bookUrl, sourcePageUrl);
            const normalized = normalizeRecord(raw);

            const result = BookSchema.safeParse(normalized);
            if (result.success) {
                validRecords.set(normalized.product_url, result.data);
            } else {
                errors.push({
                    product_url: normalized.product_url,
                    reason: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
                });
            }
        } catch (err) {
            failedPages++;
            errors.push({
                product_url: bookUrl,
                reason: err.message
            });
            console.log(`FAILED     ${bookUrl}  (${err.message})`);
        }
    }

    const books = Array.from(validRecords.values());
    const durationMs = Date.now() - startTime;

    console.log(`detail_pages=${bookLinks.size}`);
    console.log(`valid_records=${books.length}`);
    console.log(`invalid_records=${errors.length}`);
    console.log(`failed_pages=${failedPages}`);

    fs.writeFileSync(
        path.join(OUTPUT_DIR, "books.json"),
        JSON.stringify(books, null, 2)
    );
    fs.writeFileSync(
        path.join(OUTPUT_DIR, "errors.json"),
        JSON.stringify(errors, null, 2)
    );

    const runReport = {
        start_time: new Date(startTime).toISOString(),
        duration_ms: durationMs,
        catalogue_pages_fetched: cataloguePages,
        catalogue_page_cache_hits: cataloguePageCacheHits,
        book_pages_discovered: bookLinks.size,
        book_page_cache_hits: bookPageCacheHits,
        valid_records: books.length,
        invalid_records: errors.length,
        failed_pages: failedPages
    };

    fs.writeFileSync(
        path.join(OUTPUT_DIR, "run-report.json"),
        JSON.stringify(runReport, null, 2)
    );

    console.log("\nRun report:");
    console.log(JSON.stringify(runReport, null, 2));
}

main().catch((err) => {
    console.error("Run failed:", err.message);
    process.exit(1);
});