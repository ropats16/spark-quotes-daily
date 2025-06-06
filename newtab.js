// newtab.js

// ─────────────────────────────────────────────────────────────────────────────
// 1) Local quotes.json inside the extension
//    Used for randomly picking a quote on each new tab
// ─────────────────────────────────────────────────────────────────────────────
const QUOTES_URL = chrome.runtime.getURL("quotes.json");

// ─────────────────────────────────────────────────────────────────────────────
// 2) Your Cloudflare Worker’s published URL (for Unsplash JSON API)
//    Replace this placeholder with your real worker URL
// ─────────────────────────────────────────────────────────────────────────────
const PROXY_URL = "https://sqd-unsplash-proxy.sqd-unsplash-proxy.workers.dev";

// ─────────────────────────────────────────────────────────────────────────────
// 3) Three preloaded images (bundled inside the extension under /preloaded/)
//    These are painted immediately so the user never sees gray.
// ─────────────────────────────────────────────────────────────────────────────
const PRELOADED_IMAGES = [
  chrome.runtime.getURL("preloaded/img1.jpg"),
  chrome.runtime.getURL("preloaded/img2.jpg"),
  chrome.runtime.getURL("preloaded/img3.jpg"),
];

// ─────────────────────────────────────────────────────────────────────────────
// 4) Themed keywords for Unsplash backgrounds
//    We will randomly pick one keyword each time we fetch a new batch of 10 images.
// ─────────────────────────────────────────────────────────────────────────────
const IMAGE_KEYWORDS = [
  "grand canyon sunset",
  "machu picchu sunrise",
  "salar de uyuni mirror",
  "uttarakhand himalayas",
  "empire state building nighttime",
  "great wall of china misty",
  "patagonia mountain range",
  "norwegian fjords twilight",
  "iceland waterfall",
  "sahara desert dunes",
  "death valley highway",
  "pacific coast highway overlook",
  "underwater sea cave opening",
  "infinity pool overlooking city",
  "serengeti sunrise",
  "nyc skyline from helicopter",
  "tokyo skyline at dusk",
  "dubai desert cityscape",
  "rio de janeiro from sugarloaf",
  "winding mountain road overlooking valley",
  "cliff edge overlooking ocean",
  "person standing at cliff edge",
  "sailboat at sunset on ocean",
  "misty forest at dawn",
  "lone runner on desert road",
  "nighttime city lights aerial view",
  "waterfall with rainbow mist",
  "rocky mountain sunrise",
  "foggy bridge with dramatic lighting",
];

// ─────────────────────────────────────────────────────────────────────────────
// 5) localStorage keys & cache configuration
//    We want to keep up to `TARGET_CACHE_SIZE` images cached at any given time.
//    Every `CACHE_REFRESH_INTERVAL` (4 hours), we fetch a brand‐new batch.
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_KEY = "sq_image_cache"; // localStorage: array of {url, photographer, profile}
const CACHE_TIMESTAMP_KEY = "sq_image_cache_time"; // localStorage: ms since epoch when last fetched
const TARGET_CACHE_SIZE = 10; // Request 10 images at once
const CACHE_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours (milliseconds)
const CACHE_TTL = CACHE_REFRESH_INTERVAL; // After 4h, the batch is stale

// ─────────────────────────────────────────────────────────────────────────────
// 6) DOM references
// ─────────────────────────────────────────────────────────────────────────────
const bgDiv = document.getElementById("bgDiv");
const quoteTextEl = document.getElementById("quoteText");
const quoteAuthorEl = document.getElementById("quoteAuthor");
const unsplashCreditEl = document.getElementById("unsplashCredit");

// ─────────────────────────────────────────────────────────────────────────────
// 7) Helper: pick a random quote from quotesArray
// ─────────────────────────────────────────────────────────────────────────────
function pickRandomQuote(quotesArray) {
  const idx = Math.floor(Math.random() * quotesArray.length);
  return quotesArray[idx];
}

// ─────────────────────────────────────────────────────────────────────────────
// 8) Helper: pick a random Unsplash keyword from IMAGE_KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────
function pickRandomKeyword() {
  return IMAGE_KEYWORDS[Math.floor(Math.random() * IMAGE_KEYWORDS.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 9) Fallback gradient if no images can be loaded at all
// ─────────────────────────────────────────────────────────────────────────────
function applyGradientFallback() {
  bgDiv.style.backgroundImage =
    "linear-gradient(135deg, #A3BFFA 0%, #667EEA 100%)";
}

// ─────────────────────────────────────────────────────────────────────────────
// 10) Fetch a _BATCH_ of Unsplash photos via your Worker
//
//     We call: GET `${PROXY_URL}/?keyword=<someKeyword>&count=<TARGET_CACHE_SIZE>`
//     Unsplash returns an array of up to <count> photo objects.
//     We transform those into { url, photographer, profile } and return that array.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchBatchImages(count) {
  // 10a) Pick a single random keyword for the entire batch
  const keyword = pickRandomKeyword();

  // 10b) Build the Worker URL with `count`
  const workerURL = new URL(PROXY_URL);
  workerURL.searchParams.set("keyword", keyword);
  workerURL.searchParams.set("count", String(count));

  try {
    const res = await fetch(workerURL.toString());
    if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    const data = await res.json();

    // 10c) `data` should be an array if count > 1; fallback if it is a single object
    const photoArray = Array.isArray(data) ? data : [data];

    // 10d) Map to our minimal format, filtering out any invalid entries
    const valid = photoArray
      .filter(
        (item) =>
          item &&
          item.urls &&
          typeof item.urls.full === "string" &&
          item.user &&
          typeof item.user.name === "string" &&
          item.user.links &&
          typeof item.user.links.html === "string"
      )
      .map((item) => ({
        url: item.urls.full,
        photographer: item.user.name,
        profile: item.user.links.html,
      }));

    return valid; // array of {url, photographer, profile}, length ≤ count
  } catch (err) {
    console.error("fetchBatchImages error:", err);
    return []; // Return an empty array on failure
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11) Refresh the image cache if needed.
//     We decide to refresh when ANY of the following is true:
//       • There is no existing timestamp (first run)
//       • The timestamp is older than CACHE_REFRESH_INTERVAL (i.e. > 4h old)
//       • The existing cache array has length < TARGET_CACHE_SIZE/2 (i.e. < 5 images remain)
// ─────────────────────────────────────────────────────────────────────────────
let isCacheRefreshInProgress = false;

async function refreshImageCacheIfNeeded() {
  // 11a) If another refresh is already happening, skip
  if (isCacheRefreshInProgress) {
    console.log("[Cache] Refresh already in progress, skipping.");
    return;
  }

  // 11b) Read the stored timestamp (ms since epoch)
  const rawTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);
  const ts = rawTs ? parseInt(rawTs, 10) : 0;

  // 11c) Read the stored cache array length
  let cacheArray = [];
  const rawCache = localStorage.getItem(CACHE_KEY);
  try {
    cacheArray = rawCache ? JSON.parse(rawCache) : [];
  } catch {
    cacheArray = [];
  }

  // 11d) Determine if we need to refresh
  const age = isNaN(ts) ? Infinity : Date.now() - ts;
  const needsTimeRefresh = isNaN(ts) || age > CACHE_REFRESH_INTERVAL;
  const needsSizeRefresh =
    !Array.isArray(cacheArray) || cacheArray.length < TARGET_CACHE_SIZE / 2;

  if (!needsTimeRefresh && !needsSizeRefresh) {
    console.log(
      `[Cache] Fresh (age ${Math.round(age / 60000)}m, count ${
        cacheArray.length
      }) → no refresh.`
    );
    return;
  }

  // 11e) Mark that we are now refreshing
  isCacheRefreshInProgress = true;
  console.log(
    `[Cache] Refreshing (age: ${
      isNaN(ts) ? "none" : Math.round(age / 60000) + "m"
    }, count: ${cacheArray.length}).`
  );

  try {
    // 11f) Fetch a new batch of TARGET_CACHE_SIZE images
    const newBatch = await fetchBatchImages(TARGET_CACHE_SIZE);

    if (newBatch.length > 0) {
      // 11g) Overwrite cache with these newly fetched images
      localStorage.setItem(CACHE_KEY, JSON.stringify(newBatch));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
      console.log(
        `[Cache] Stored ${
          newBatch.length
        } new images at ${new Date().toLocaleTimeString()}.`
      );
    } else {
      // 11h) If the fetch failed to return anything, update timestamp anyway
      console.warn(
        "[Cache] No valid images fetched; storing only timestamp to delay next attempt."
      );
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    }
  } catch (err) {
    console.error("[Cache] refreshImageCacheIfNeeded error:", err);
    // Update timestamp even on error, so we don’t hammer the API
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } finally {
    isCacheRefreshInProgress = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12) Synchronously retrieve one image from the cache (if valid & fresh)
//     Returns an object { url, photographer, profile } or null if none exist.
// ─────────────────────────────────────────────────────────────────────────────
function getBackgroundFromCacheSync() {
  const rawCache = localStorage.getItem(CACHE_KEY);
  const rawTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);

  if (!rawCache || !rawTs) {
    console.log("[Cache] Miss (no cache or no timestamp).");
    return null;
  }

  const ts = parseInt(rawTs, 10);
  if (isNaN(ts) || Date.now() - ts > CACHE_TTL) {
    console.log("[Cache] Miss (stale cache).");
    // Purge stale cache
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    return null;
  }

  let cacheArray;
  try {
    cacheArray = JSON.parse(rawCache);
  } catch {
    console.warn("[Cache] Miss (failed to parse JSON).");
    cacheArray = [];
  }

  if (!Array.isArray(cacheArray) || cacheArray.length === 0) {
    console.log("[Cache] Miss (cache array empty).");
    return null;
  }

  // Pop one entry from the front
  const entry = cacheArray.shift();
  localStorage.setItem(CACHE_KEY, JSON.stringify(cacheArray));
  console.log(`[Cache] Hit (popped one; ${cacheArray.length} remain).`);
  return entry; // { url, photographer, profile }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13) MAIN IIFE (Immediate Function) that runs as soon as newtab.js is parsed.
//
//     A) Immediately _paint_ a randomly chosen preloaded image (no condition).
//     B) Then attempt a synchronous cache lookup. If a cached URL exists, swap it in.
//     C) Afterwards (async), call refreshImageCacheIfNeeded() to fetch a new batch if required.
//     D) Finally, fetch & display a random quote (async).
//
//     At no point does the user see a blank or gray background—
//     the preloaded image is always on screen until a cached or fresh Unsplash image is swapped in.
// ─────────────────────────────────────────────────────────────────────────────
(function initializeTab() {
  // ──── A) Immediately paint a random preloaded image ─────────────────────────
  const randIdx = Math.floor(Math.random() * PRELOADED_IMAGES.length);
  const fallbackUrl = PRELOADED_IMAGES[randIdx];
  bgDiv.style.backgroundImage = `url("${fallbackUrl}")`;
  unsplashCreditEl.textContent = ""; // No credit for a bundled image
  console.log("[Init] Painted preloaded image.");

  // ──── B) Synchronous cache lookup ────────────────────────────────────────
  const bgEntry = getBackgroundFromCacheSync();
  if (bgEntry && bgEntry.url) {
    // If we got a valid cached object, swap in the Unsplash image _immediately_:
    bgDiv.style.backgroundImage = `url("${bgEntry.url}")`;
    unsplashCreditEl.textContent = `Photo by ${bgEntry.photographer} on Unsplash`;
    unsplashCreditEl.href =
      bgEntry.profile + "?utm_source=spark-quotes-daily&utm_medium=referral";
  }

  // ──── C) Asynchronously refresh the cache if needed ─────────────────────────
  (async function refreshIfRequired() {
    const rawTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    const ts = rawTs ? parseInt(rawTs, 10) : 0;
    let cacheArray = [];
    try {
      cacheArray = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    } catch {
      cacheArray = [];
    }

    const age = isNaN(ts) ? Infinity : Date.now() - ts;
    const needsTimeRefresh = isNaN(ts) || age > CACHE_REFRESH_INTERVAL;
    const needsSizeRefresh =
      !Array.isArray(cacheArray) || cacheArray.length < TARGET_CACHE_SIZE / 2;

    if (needsTimeRefresh || needsSizeRefresh) {
      console.log(
        "[Cache Check] Refresh conditions met. Fetching new batch..."
      );
      await prefetchImageBatch();
    } else {
      console.log(
        `[Cache Check] No refresh needed—age ${Math.round(
          age / 60000
        )}m, count ${cacheArray.length}.`
      );
    }
  })().catch((err) => {
    console.error("[Cache Refresh Error]", err);
  });

  // ──── D) Fetch & display a random quote (asynchronously) ─────────────────────
  fetch(QUOTES_URL)
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load quotes.json");
      return res.json();
    })
    .then((quotesArray) => {
      if (!Array.isArray(quotesArray) || quotesArray.length === 0) {
        throw new Error("No quotes found.");
      }
      const { text, author } = pickRandomQuote(quotesArray);
      quoteTextEl.textContent = `"${text}"`;
      quoteAuthorEl.textContent = author ? `— ${author}` : "— Anon";
    })
    .catch((err) => {
      console.error("[Quote Error]", err);
      if (!quoteTextEl.textContent.trim()) {
        quoteTextEl.textContent = "An inspiring day awaits.";
        quoteAuthorEl.textContent = "";
      }
    });
})();
