const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const USER_AGENT = "FlyRankInternshipA9/1.0 (+https://github.com/G-Bharat-Sai/books-scraper)";
const CACHE_DIR = path.join(__dirname, "..", "cache");
const TIMEOUT_MS = 8000;
const DELAY_MS = 500;
const MAX_CATALOGUE_PAGES = 3;

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        // Resolves relative hrefs like "../../book-name/index.html"
        // against the page's own URL — never by string concatenation,
        // which breaks on "../" segments and trailing-slash edge cases.
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
    const allLinks = new Set();

    while (pageUrl && pageNumber <= MAX_CATALOGUE_PAGES) {
        const html = await fetchWithCache(pageUrl, `catalogue-page-${pageNumber}.html`);
        const { bookLinks, nextPageUrl } = parseCataloguePage(html, pageUrl);

        for (const link of bookLinks) {
            allLinks.add(link);
        }

        pageUrl = nextPageUrl;
        pageNumber++;
    }

    return {
        cataloguePages: pageNumber - 1,
        uniqueUrls: Array.from(allLinks)
    };
}

async function main() {
    const { cataloguePages, uniqueUrls } = await discoverAllBookLinks();

    console.log(`catalogue_pages=${cataloguePages}`);
    console.log(`discovered=${uniqueUrls.length}`);
    console.log(`unique_urls=${uniqueUrls.length}`);
}

main().catch((err) => {
    console.error("Run failed:", err.message);
    process.exit(1);
});