// newtab.js

// 1. Local quotes.json inside the extension
const QUOTES_URL = chrome.runtime.getURL("quotes.json");

// 2. Your Worker’s published URL (for Unsplash JSON API)
const PROXY_URL = "https://sqd-unsplash-proxy.sqd-unsplash-proxy.workers.dev";

// 3. Three preloaded images (bundled in /preloaded/)
const PRELOADED_IMAGES = [
  chrome.runtime.getURL("preloaded/img1.jpg"),
  chrome.runtime.getURL("preloaded/img2.jpg"),
  chrome.runtime.getURL("preloaded/img3.jpg"),
];

// 4. Themed keywords for Unsplash backgrounds
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

// 5. Cache keys and config
const CACHE_KEY = "sq_image_cache"; // Array of { url, photographer, profile }
const CACHE_TIMESTAMP_KEY = "sq_image_cache_time"; // Epoch ms when last fetched
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms
const BATCH_SIZE = 5; // Prefetch 5 images at a time

// 6. DOM references
const bgDiv = document.getElementById("bgDiv");
const quoteTextEl = document.getElementById("quoteText");
const quoteAuthorEl = document.getElementById("quoteAuthor");
const unsplashCreditEl = document.getElementById("unsplashCredit");

// 7. Utility: pick a random quote from the loaded array
function pickRandomQuote(quotesArray) {
  const idx = Math.floor(Math.random() * quotesArray.length);
  return quotesArray[idx];
}

// 8. Utility: pick a random Unsplash keyword
function pickRandomKeyword() {
  return IMAGE_KEYWORDS[Math.floor(Math.random() * IMAGE_KEYWORDS.length)];
}

// 9. Fallback gradient (if everything else fails)
function applyGradientFallback() {
  bgDiv.style.backgroundImage =
    "linear-gradient(135deg, #A3BFFA 0%, #667EEA 100%)";
}

// 10. Fetch ONE Unsplash photo via your Worker
//    Returns a promise resolving to {url, photographer, profile} or null on failure
function fetchSingleImage() {
  const keyword = pickRandomKeyword();
  const workerURL = `${PROXY_URL}/?keyword=${encodeURIComponent(keyword)}`;
  return fetch(workerURL)
    .then((res) => {
      if (!res.ok) throw new Error("Worker returned " + res.status);
      return res.json();
    })
    .then((data) => {
      if (data && data.urls && data.urls.full && data.user) {
        return {
          url: data.urls.full,
          photographer: data.user.name,
          profile: data.user.links.html,
        };
      }
      throw new Error("Invalid JSON from Worker");
    })
    .catch((err) => {
      console.error("fetchSingleImage error:", err);
      return null;
    });
}

// 11. Prefetch a batch of Unsplash photos into localStorage (runs asynchronously)
async function prefetchImageBatch() {
  const promises = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    promises.push(fetchSingleImage());
  }
  const results = await Promise.all(promises);

  // Filter out any nulls (failed fetches), keep only valid objects
  const valid = results.filter((item) => item && item.url);
  if (valid.length > 0) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(valid));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  }
  return valid;
}

// 12. Synchronous check: get ONE background from cache if available & fresh
//    If no cache exists or TTL expired or array empty, return null
function getBackgroundFromCacheSync() {
  const rawCache = localStorage.getItem(CACHE_KEY);
  const rawTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!rawCache || !rawTs) {
    return null; // No cache at all
  }

  const ts = parseInt(rawTs, 10);
  if (isNaN(ts) || Date.now() - ts > CACHE_TTL) {
    return null; // Cache expired
  }

  let cacheArray;
  try {
    cacheArray = JSON.parse(rawCache);
  } catch {
    cacheArray = [];
  }
  if (!Array.isArray(cacheArray) || cacheArray.length === 0) {
    return null; // Nothing to pop
  }

  // Pop one entry off the front
  const entry = cacheArray.shift();
  localStorage.setItem(CACHE_KEY, JSON.stringify(cacheArray));
  return entry; // { url, photographer, profile }
}

// 13. MAIN LOGIC: ALWAYS set a preloaded image immediately
(function initializeTab() {
  // 13a. Instantly pick one of the 3 bundled images
  const randIdx = Math.floor(Math.random() * PRELOADED_IMAGES.length);
  const fallbackUrl = PRELOADED_IMAGES[randIdx];
  bgDiv.style.backgroundImage = `url("${fallbackUrl}")`;
  // No photographer credit for a bundled image:
  unsplashCreditEl.textContent = "";

  // 13b. Now fetch & display a quote (does not block the preloaded background)
  fetch(QUOTES_URL)
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load quotes.json");
      return res.json();
    })
    .then(async (quotesArray) => {
      if (!Array.isArray(quotesArray) || quotesArray.length === 0) {
        throw new Error("No quotes found.");
      }

      // 13c. Display a random quote
      const { text, author } = pickRandomQuote(quotesArray);
      quoteTextEl.textContent = `"${text}"`;
      quoteAuthorEl.textContent = author ? `— ${author}` : "— Anon";

      // 13d. Check if we have a cached Unsplash entry
      const bgEntry = getBackgroundFromCacheSync();
      if (bgEntry && bgEntry.url) {
        // 13e. If yes, swap in that Unsplash image immediately
        bgDiv.style.backgroundImage = `url("${bgEntry.url}")`;
        unsplashCreditEl.textContent = `Photo by ${bgEntry.photographer} on Unsplash`;
        unsplashCreditEl.href =
          bgEntry.profile +
          "?utm_source=spark-quotes-daily&utm_medium=referral";
      } else {
        // 13f. If no cache, kick off a batch prefetch (but do NOT await it here)
        prefetchImageBatch();
        // We leave the preloaded image on screen; the next tab or after prefetch, a new tab will use a cached entry.
      }
    })
    .catch((err) => {
      console.error(err);
      // If quotes.json fails entirely, show fallback text
      if (!quoteTextEl.textContent) {
        quoteTextEl.textContent = "An inspiring day awaits.";
        quoteAuthorEl.textContent = "";
      }
      // And leave the preloaded image we already set
      unsplashCreditEl.textContent = "";
    });
})();
