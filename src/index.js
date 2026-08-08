const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Turns a book detail URL into a safe, unique cache filename, e.g.
// "https://.../a-light-in-the-attic_1000/index.html" -> "book-a-light-in-the-attic_1000.html"
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
    const allLinks = new Map(); // bookUrl -> sourcePageUrl

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
        bookLinks: allLinks // Map of bookUrl -> which catalogue page it came from
    };
}

// Aims selectors at the product's own info box, not the whole page,
// so a description/comments/related-books section elsewhere on the
// page can never accidentally be picked up as "the price."
function parseBookPage(html, bookUrl, sourcePageUrl) {
    const $ = cheerio.load(html);
    const product = $(".product_main");

    const title = product.find("h1").text().trim();
    const priceText = product.find(".price_color").first().text().trim();
    const availabilityText = product.find(".availability").text().trim();

    const ratingClass = product.find(".star-rating").attr("class") || "";
    const ratingText = ratingClass.replace("star-rating", "").trim();

    // Description section is entirely absent for some books — store
    // null rather than an empty string or invented text.
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

async function main() {
    const { cataloguePages, bookLinks } = await discoverAllBookLinks();

    console.log(`catalogue_pages=${cataloguePages}`);
    console.log(`discovered=${bookLinks.size}`);

    const records = [];
    for (const [bookUrl, sourcePageUrl] of bookLinks) {
        const cacheFilename = cacheFilenameForBookUrl(bookUrl);
        const html = await fetchWithCache(bookUrl, cacheFilename);
        const record = parseBookPage(html, bookUrl, sourcePageUrl);
        records.push(record);
    }

    console.log(`detail_pages=${records.length}`);
    console.log("\nSample record:");
    console.log(JSON.stringify(records[0], null, 2));

    fs.writeFileSync(
        path.join(OUTPUT_DIR, "raw-records.json"),
        JSON.stringify(records, null, 2)
    );
}

main().catch((err) => {
    console.error("Run failed:", err.message);
    process.exit(1);
});