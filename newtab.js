// newtab.js

const QUOTES_URL = chrome.runtime.getURL("quotes.json");

const PROXY_URL = "https://sqd-unsplash-proxy.sqd-unsplash-proxy.workers.dev";

const PRELOADED_IMAGES = [
  chrome.runtime.getURL("preloaded/img1.jpg"),
  chrome.runtime.getURL("preloaded/img2.jpg"),
  chrome.runtime.getURL("preloaded/img3.jpg"),
];

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

const CACHE_KEY = "sq_image_cache"; // localStorage → JSON‐stringified array of metadata
const CACHE_TIMESTAMP_KEY = "sq_image_cache_time"; // localStorage → ms since epoch of last batch
const TARGET_CACHE_SIZE = 10; // fetch 10 images at once
const CACHE_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours in ms
const CACHE_TTL = CACHE_REFRESH_INTERVAL; // after 4h, batch is stale

const bgDiv = document.getElementById("bgDiv");
const quoteTextEl = document.getElementById("quoteText");
const quoteAuthorEl = document.getElementById("quoteAuthor");
const unsplashCreditEl = document.getElementById("unsplashCredit");

function pickRandomQuote(quotesArray) {
  const idx = Math.floor(Math.random() * quotesArray.length);
  return quotesArray[idx];
}

function pickRandomKeyword() {
  return IMAGE_KEYWORDS[Math.floor(Math.random() * IMAGE_KEYWORDS.length)];
}

function applyGradientFallback() {
  bgDiv.style.backgroundImage =
    "linear-gradient(135deg, #A3BFFA 0%, #667EEA 100%)";
}

async function fetchBatchImages(count) {
  const keyword = pickRandomKeyword();
  const workerURL = new URL(PROXY_URL);
  workerURL.searchParams.set("keyword", keyword);
  workerURL.searchParams.set("count", String(count));

  try {
    const res = await fetch(workerURL.toString());
    if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    const data = await res.json();

    // data might be a single object (if count=1) or an array (if count>1)
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

let dbPromise = null;

function openImageDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("sq-image-db", 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("images")) {
        // keyPath "id" will auto-increment
        db.createObjectStore("images", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });

  return dbPromise;
}

async function storeBatchAsBlobs(newBatch) {
  // 1) Fetch all the URLs as Blobs (in parallel)
  const blobPromises = newBatch.map(async (item, idx) => {
    try {
      const imageRes = await fetch(item.url);
      if (!imageRes.ok)
        throw new Error(`Image fetch ${idx} returned ${imageRes.status}`);
      const blob = await imageRes.blob();
      return { blob, photographer: item.photographer, profile: item.profile };
    } catch (error) {
      console.error(`Error fetching blob #${idx}:`, error);
      return null;
    }
  });

  const results = await Promise.all(blobPromises);
  const validBlobs = results.filter((x) => x && x.blob);

  if (validBlobs.length === 0) {
    console.warn("[IDB] No valid blobs fetched, skipping store.");
    return;
  }

  // 2) Open IDB and do a single transaction to put them all
  try {
    const db = await openImageDatabase();
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");

    validBlobs.forEach((entry) => {
      store.put({
        blob: entry.blob,
        photographer: entry.photographer,
        profile: entry.profile,
        timestamp: Date.now(),
      });
    });

    tx.oncomplete = () => {
      console.log(`[IDB] Stored ${validBlobs.length} blobs successfully.`);
    };
    tx.onerror = () => {
      console.error("[IDB] Transaction error:", tx.error);
    };
  } catch (err) {
    console.error("[IDB] Error opening/storing in database:", err);
  }
}

async function getBackgroundBlobFromCache() {
  try {
    const db = await openImageDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readwrite");
      const store = tx.objectStore("images");

      // Open a cursor to fetch the first record (lowest `id`)
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          // No records found
          resolve(null);
          return;
        }
        const record = cursor.value;

        // Delete this record so it isn’t used again
        cursor.delete();

        // Create an objectURL from the Blob
        const blobURL = URL.createObjectURL(record.blob);
        resolve({
          objectURL: blobURL,
          photographer: record.photographer,
          profile: record.profile,
        });
      };
      cursorReq.onerror = () => {
        console.error("[IDB] Cursor error:", cursorReq.error);
        resolve(null);
      };
    });
  } catch (err) {
    console.error("[IDB] getBackgroundBlobFromCache error:", err);
    return null;
  }
}

let isCacheRefreshInProgress = false;

async function refreshImageCacheIfNeeded() {
  // (a) Prevent parallel refreshes
  if (isCacheRefreshInProgress) {
    console.log("[Cache] Refresh already underway; skipping.");
    return;
  }

  // (b) Read timestamp
  const rawTs = localStorage.getItem(CACHE_TIMESTAMP_KEY);
  const ts = rawTs ? parseInt(rawTs, 10) : 0;

  // (c) Count how many items remain in IDB
  let db;
  let countInDB = 0;
  try {
    db = await openImageDatabase();
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    countInDB = await new Promise((res, rej) => {
      const countReq = store.count();
      countReq.onsuccess = () => res(countReq.result);
      countReq.onerror = () => rej(countReq.error);
    });
  } catch (err) {
    console.error("[IDB] Error counting records:", err);
    countInDB = 0;
  }

  // (d) Determine if we need a refresh
  const age = isNaN(ts) ? Infinity : Date.now() - ts;
  const needsTimeRefresh = isNaN(ts) || age > CACHE_REFRESH_INTERVAL;
  const needsSizeRefresh = countInDB < TARGET_CACHE_SIZE / 2;

  if (!needsTimeRefresh && !needsSizeRefresh) {
    console.log(
      `[Cache] No refresh needed (age ${Math.round(
        age / 60000
      )}m, ${countInDB} in IDB).`
    );
    return;
  }

  isCacheRefreshInProgress = true;
  console.log("[Cache] Refreshing now...");

  try {
    // (e) Fetch a new batch of TARGET_CACHE_SIZE URLs from Unsplash
    const newBatch = await fetchBatchImages(TARGET_CACHE_SIZE);

    if (newBatch.length > 0) {
      // (f) Store them as Blobs in IDB
      await storeBatchAsBlobs(newBatch);

      // (g) Update the timestamp so we don’t immediately refresh again
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } else {
      // (h) If no valid URLs arrived, at least set timestamp so we don’t hammer
      console.warn(
        "[Cache] Fetched batch was empty; updating timestamp anyway."
      );
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    }
  } catch (error) {
    console.error("[Cache] Error fetching/storing batch:", error);
    // Update timestamp on error so we don’t immediately retry
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } finally {
    isCacheRefreshInProgress = false;
  }
}

(function initializeTab() {
  const randIdx = Math.floor(Math.random() * PRELOADED_IMAGES.length);
  const fallbackUrl = PRELOADED_IMAGES[randIdx];
  bgDiv.style.backgroundImage = `url("${fallbackUrl}")`;
  unsplashCreditEl.textContent = ""; // No credit for the bundled image
  console.log("[Init] Painted preloaded image.");

  getBackgroundBlobFromCache()
    .then((blobEntry) => {
      if (blobEntry && blobEntry.objectURL) {
        console.log("[Init] Retrieved Blob from cache, swapping in now.");
        bgDiv.style.backgroundImage = `url("${blobEntry.objectURL}")`;
        unsplashCreditEl.textContent = `Photo by ${blobEntry.photographer} on Unsplash`;
        unsplashCreditEl.href =
          blobEntry.profile +
          "?utm_source=spark-quotes-daily&utm_medium=referral";
      } else {
        console.log(
          "[Init] No Blob in IDB for this tab, staying on preloaded."
        );
      }
    })
    .catch((err) => {
      console.error("[IDB] Error retrieving Blob for current tab:", err);
    });

  (async () => {
    try {
      await refreshImageCacheIfNeeded();
    } catch (err) {
      console.error("[Cache Refresh Error]", err);
    }
  })();

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
