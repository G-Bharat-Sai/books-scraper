const fs = require("fs");
const path = require("path");

const USER_AGENT = "FlyRankInternshipA9/1.0 (+https://github.com/G-Bharat-Sai/books-scraper)";
const CACHE_DIR = path.join(__dirname, "..", "cache");
const TIMEOUT_MS = 8000;

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchWithCache(url, cacheFilename) {
    const cachePath = path.join(CACHE_DIR, cacheFilename);

    if (fs.existsSync(cachePath)) {
        const html = fs.readFileSync(cachePath, "utf-8");
        console.log(`CACHE HIT  ${url}  (${html.length} bytes)`);
        return html;
    }
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

async function main() {
    const url = "https://books.toscrape.com/catalogue/page-1.html";
    await fetchWithCache(url, "catalogue-page-1.html");
}

main().catch((err) => {
    console.error("Run failed:", err.message);
    process.exit(1);
});