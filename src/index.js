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

for (const dir of [CACHE_DIR, OUTPUT_DIR]) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ----------------------------------------------------------------------
// Stage 4 — the schema every record must satisfy before storage
// ----------------------------------------------------------------------
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

async function fetchWithCache(url, cacheFilename) {
    const cachePath = path.join(CACHE_DIR, cacheFilename);

    if (fs.existsSync(cachePath)) {
        const html = fs.readFileSync(cachePath, "utf-8");
        console.log(`CACHE HIT  ${url}  (${html.length} bytes)`);
        return html;
    }

    await sleep(DELAY_MS);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }

    if (response.status !== 200) {
        throw new Error(`Fetch failed for ${url}: status ${response.status}`);
    }

    const html = await response.text();
    fs.writeFileSync(cachePath, html, "utf-8");
    console.log(`FETCH      ${url}  (${html.length} bytes)`);

    return html;
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

    while (pageUrl && pageNumber <= MAX_CATALOGUE_PAGES) {
        const html = await fetchWithCache(pageUrl, `catalogue-page-${pageNumber}.html`);
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
        bookLinks: allLinks
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

// ----------------------------------------------------------------------
// Stage 4 — normalize: turn raw strings into clean, typed values
// ----------------------------------------------------------------------
function normalizeRecord(raw) {
    // "£51.77" -> 51.77. Strip everything except digits and the
    // decimal point before parsing, since parseFloat/Number can't
    // handle a leading currency symbol on their own.
    const numericPrice = parseFloat(raw.price_text.replace(/[^0-9.]/g, ""));

    return {
        ...raw,
        price_gbp: numericPrice
    };
}

async function main() {
    const { cataloguePages, bookLinks } = await discoverAllBookLinks();

    console.log(`catalogue_pages=${cataloguePages}`);
    console.log(`discovered=${bookLinks.size}`);

    // Keyed by product_url (the canonical identity) so that if the
    // same book URL ever appeared twice in our link list, it would
    // naturally collapse to a single entry here.
    const validRecords = new Map();
    const errors = [];

    for (const [bookUrl, sourcePageUrl] of bookLinks) {
        const cacheFilename = cacheFilenameForBookUrl(bookUrl);
        const html = await fetchWithCache(bookUrl, cacheFilename);
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
    }

    const books = Array.from(validRecords.values());

    console.log(`detail_pages=${bookLinks.size}`);
    console.log(`valid_records=${books.length}`);
    console.log(`invalid_records=${errors.length}`);

    fs.writeFileSync(
        path.join(OUTPUT_DIR, "books.json"),
        JSON.stringify(books, null, 2)
    );
    fs.writeFileSync(
        path.join(OUTPUT_DIR, "errors.json"),
        JSON.stringify(errors, null, 2)
    );
}

main().catch((err) => {
    console.error("Run failed:", err.message);
    process.exit(1);
});