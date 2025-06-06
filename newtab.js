// newtab.js

// ─────────────────────────────────────────────────────────────────────────────
// 1) LOCAL QUOTES
//    Path to quotes.json, which is bundled in the extension.
// ─────────────────────────────────────────────────────────────────────────────
const QUOTES_URL = chrome.runtime.getURL("quotes.json");

// ─────────────────────────────────────────────────────────────────────────────
// 2) WORKER URL
//    Your Cloudflare Worker that forwards `keyword` and optional `count` to Unsplash.
//    Replace with your actual published subdomain.
// ─────────────────────────────────────────────────────────────────────────────
const PROXY_URL = "https://sqd-unsplash-proxy.sqd-unsplash-proxy.workers.dev";

// ─────────────────────────────────────────────────────────────────────────────
// 3) PRELOADED IMAGES
//    Three fallback JPEGs (bundled under /preloaded/) so the first paint is never gray.
// ─────────────────────────────────────────────────────────────────────────────
const PRELOADED_IMAGES = [
  chrome.runtime.getURL("preloaded/img1.jpg"),
  chrome.runtime.getURL("preloaded/img2.jpg"),
  chrome.runtime.getURL("preloaded/img3.jpg"),
];

// ─────────────────────────────────────────────────────────────────────────────
// 4) UNSPLASH KEYWORDS
//    We’ll pick one random keyword each time we do a batch fetch of 10 images.
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
// 5) CACHE CONFIGURATION
//    We store an array of up to 10 fetched images (each is {url, photographer, profile}).
//    Every 4 hours (or when fewer than 5 remain), we refresh the entire batch.
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_KEY = "sq_image_cache"; // localStorage → JSON‐stringified array
const CACHE_TIMESTAMP_KEY = "sq_image_cache_time"; // localStorage → ms since epoch of last batch
const TARGET_CACHE_SIZE = 10; // fetch 10 images at once
const CACHE_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours in ms
const CACHE_TTL = CACHE_REFRESH_INTERVAL; // after 4h, batch is stale

// ─────────────────────────────────────────────────────────────────────────────
// 6) DOM REFERENCES
// ─────────────────────────────────────────────────────────────────────────────
const bgDiv = document.getElementById("bgDiv");
const quoteTextEl = document.getElementById("quoteText");
const quoteAuthorEl = document.getElementById("quoteAuthor");
const unsplashCreditEl = document.getElementById("unsplashCredit");

// ─────────────────────────────────────────────────────────────────────────────
// 7) PICK A RANDOM QUOTE
// ─────────────────────────────────────────────────────────────────────────────
function pickRandomQuote(quotesArray) {
  const idx = Math.floor(Math.random() * quotesArray.length);
  return quotesArray[idx];
}

// ─────────────────────────────────────────────────────────────────────────────
// 8) PICK A RANDOM UNSPLASH KEYWORD
// ─────────────────────────────────────────────────────────────────────────────
function pickRandomKeyword() {
  return IMAGE_KEYWORDS[Math.floor(Math.random() * IMAGE_KEYWORDS.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 9) FALLBACK GRADIENT
// ─────────────────────────────────────────────────────────────────────────────
function applyGradientFallback() {
  bgDiv.style.backgroundImage =
    "linear-gradient(135deg, #A3BFFA 0%, #667EEA 100%)";
}

// ─────────────────────────────────────────────────────────────────────────────
// 10) FETCH A BATCH OF UP TO `count` IMAGES VIA WORKER
//
//     Returns a Promise that resolves to an array of valid {url, photographer, profile} objects.
//     If the Worker returns an error or invalid JSON, we return an empty array.
//
//     Example Worker request:
//       GET https://.../workers.dev/?keyword=iceland&count=10
//     Unsplash responds with an array of up to 10 photo objects.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchBatchImages(count) {
  const keyword = pickRandomKeyword();
  const workerURL = new URL(PROXY_URL);
  workerURL.searchParams.set("keyword", keyword);
  workerURL.searchParams.set("count", String(count));

  try {
    const res = await fetch(workerURL.toString());
    if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    const data = await res.json();

    // data might be a single object if count=1, or an array if count>1
    const photoArray = Array.isArray(data) ? data : [data];

    // Keep only objects that have valid fields
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

    return valid; // length ≤ count
  } catch (err) {
    console.error("[fetchBatchImages] Network or parsing error:", err);
    return []; // On any failure, return an empty array
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11) REFRESH THE IMAGE CACHE IF NEEDED
//
//     We refresh if any of these are true:
//       • No timestamp exists (first run)
//       • Timestamp is older than 4h
//       • Remaining images in cache < TARGET_CACHE_SIZE/2 (i.e. < 5 remain)
//
//     After fetching, we _immediately_ replace the current tab’s background
//     with the **first** of the newly fetched images (if that tab is still showing
//     a preloaded image), then store the **remaining** N−1 images in cache.
//
//     This guarantees that as soon as the batch arrives, the user sees a fresh
//     Unsplash image instead of the fallback, and the rest wait in localStorage
//     for subsequent tabs.
// ─────────────────────────────────────────────────────────────────────────────
let isCacheRefreshInProgress = false;

async function refreshImageCacheIfNeeded() {
  // a) Prevent parallel refreshes
  if (isCacheRefreshInProgress) {
    console.log("[Cache] Refresh already underway; skipping.");
    return;
  }

  // b) Read timestamp and cache
  const rawTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);
  const ts = rawTs ? parseInt(rawTs, 10) : 0;

  let cacheArray = [];
  try {
    cacheArray = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
  } catch {
    cacheArray = [];
  }

  // c) Determine if refresh is needed
  const age = isNaN(ts) ? Infinity : Date.now() - ts;
  const needsTimeRefresh = isNaN(ts) || age > CACHE_REFRESH_INTERVAL;
  const needsSizeRefresh =
    !Array.isArray(cacheArray) || cacheArray.length < TARGET_CACHE_SIZE / 2;

  if (!needsTimeRefresh && !needsSizeRefresh) {
    console.log(
      `[Cache] No refresh needed (age ${Math.round(age / 60000)}m, ${
        cacheArray.length
      } in cache).`
    );
    return;
  }

  isCacheRefreshInProgress = true;
  console.log("[Cache] Refreshing now...");

  try {
    // d) Fetch a new batch of TARGET_CACHE_SIZE images
    const newBatch = await fetchBatchImages(TARGET_CACHE_SIZE);

    if (newBatch.length > 0) {
      // e) Immediately replace current tab’s background with the first fetched image
      //    But only if the user is still seeing a fallback (preloaded) image.
      //    We detect this by checking if unsplashCreditEl is empty (which means fallback).
      if (!unsplashCreditEl.textContent) {
        // const [first, ...rest] = newBatch;
        // console.log(
        //   "[Cache] Swapping in freshly fetched image for current tab."
        // );
        // bgDiv.style.backgroundImage = `url("${first.url}")`;
        // unsplashCreditEl.textContent = `Photo by ${first.photographer} on Unsplash`;
        // unsplashCreditEl.href =
        //   first.profile + "?utm_source=spark-quotes-daily&utm_medium=referral";

        // Store the remaining N−1 images back into localStorage
        localStorage.setItem(CACHE_KEY, JSON.stringify(rest));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        console.log(`[Cache] Stored ${rest.length} images for future tabs.`);
      } else {
        // If unsplashCreditEl already had text, it means a cached image was used,
        // so we simply overwrite the entire cache with the fresh batch:
        localStorage.setItem(CACHE_KEY, JSON.stringify(newBatch));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        console.log(
          `[Cache] Stored ${newBatch.length} new images for future tabs.`
        );
      }
    } else {
      // f) If no newBatch images arrived, at least update timestamp so we don’t hammer the API
      console.warn(
        "[Cache] Fetched batch was empty; timestamp updated to avoid immediate retry."
      );
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    }
  } catch (error) {
    console.error("[Cache] Error fetching batch:", error);
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } finally {
    isCacheRefreshInProgress = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12) SYNCHRONOUSLY RETRIEVE ONE IMAGE FROM CACHE (IF VALID & FRESH)
//
//     Returns { url, photographer, profile } or null if none available.
//     If an entry is found, we pop it off the cache array and save the remainder.
// ─────────────────────────────────────────────────────────────────────────────
function getBackgroundFromCacheSync() {
  const rawCache = localStorage.getItem(CACHE_KEY);
  const rawTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);

  if (!rawCache || !rawTs) {
    console.log("[Cache] MISS (no data).");
    return null;
  }

  const ts = parseInt(rawTs, 10);
  if (isNaN(ts) || Date.now() - ts > CACHE_TTL) {
    console.log("[Cache] MISS (stale).");
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    return null;
  }

  let cacheArray = [];
  try {
    cacheArray = JSON.parse(rawCache);
  } catch {
    console.warn("[Cache] MISS (parse error).");
    cacheArray = [];
  }

  if (!Array.isArray(cacheArray) || cacheArray.length === 0) {
    console.log("[Cache] MISS (empty array).");
    return null;
  }

  // Pop one entry
  const entry = cacheArray.shift();
  localStorage.setItem(CACHE_KEY, JSON.stringify(cacheArray));
  console.log(`[Cache] HIT (popped one; ${cacheArray.length} remain).`);
  return entry; // { url, photographer, profile }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13) MAIN IIFE: orchestrates everything in order
//
//     A) Immediately paint a preloaded image (no checks, no waits).
//     B) Synchronously see if there’s a cached Unsplash image; if yes, swap it in.
//     C) Asynchronously call refreshImageCacheIfNeeded() to fetch a new batch if needed.
//     D) Asynchronously load & display a random quote.
//
//     This order guarantees that the user never sees a blank or gray screen.
//     The preloaded JPEG is always on screen until either a cached or freshly
//     fetched Unsplash image replaces it.
// ─────────────────────────────────────────────────────────────────────────────
(function initializeTab() {
  // ───── A) Show preloaded JPEG immediately ───────────────────────────────────
  const randIdx = Math.floor(Math.random() * PRELOADED_IMAGES.length);
  const fallbackUrl = PRELOADED_IMAGES[randIdx];
  bgDiv.style.backgroundImage = `url("${fallbackUrl}")`;
  unsplashCreditEl.textContent = ""; // No credit for the bundled image
  console.log("[Init] Painted preloaded image.");

  // ───── B) Synchronous cache lookup ─────────────────────────────────────────
  const bgEntry = getBackgroundFromCacheSync();
  if (bgEntry && bgEntry.url) {
    console.log("[Init] Found cached Unsplash image → swapping in.");
    bgDiv.style.backgroundImage = `url("${bgEntry.url}")`;
    unsplashCreditEl.textContent = `Photo by ${bgEntry.photographer} on Unsplash`;
    unsplashCreditEl.href =
      bgEntry.profile + "?utm_source=spark-quotes-daily&utm_medium=referral";
  }

  // ───── C) Async cache refresh if needed ────────────────────────────────────
  (async function () {
    try {
      await refreshImageCacheIfNeeded();
    } catch (err) {
      console.error("[Cache Refresh Error]", err);
    }
  })();

  // ───── D) Fetch & display a random quote ───────────────────────────────────
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
