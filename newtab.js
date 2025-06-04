// newtab.js

// 1. URL to your hosted quotes.json (replace with your GitHub username and repo)
const QUOTES_URL =
  "https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>/main/quotes.json";

// 2. Keywords reflecting the themes of daring, presence, wonder, and vastness.
//    These include unique locations on Earth and “moments” or scenes that convey those emotions.
const IMAGE_KEYWORDS = [
  // Grand landscapes & monuments
  "grand canyon sunset",
  "machu picchu sunrise",
  "salar de uyuni mirror", // reflection on salt flats
  "uttarakhand himalayas", // Himalayan peaks and winding roads
  "empire state building nighttime",
  "great wall of china misty",
  "patagonia mountain range",
  "norwegian fjords twilight",
  "iceland waterfall",

  // Vast deserts & oceans
  "sahara desert dunes",
  "death valley highway",
  "pacific coast highway overlook", // winding road along cliffs
  "underwater sea cave opening", // diver peeking at sunlight
  "infinity pool overlooking city", // swimmer at rooftop edge
  "serengeti sunrise", // African savanna dawn

  // Cityscapes & aerial moments
  "nyc skyline from helicopter",
  "tokyo skyline at dusk",
  "dubai desert cityscape",
  "rio de janeiro from sugarloaf",

  // “Moments” or situations with emotional resonance
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

// 3. DOM elements
const quoteTextEl = document.getElementById("quoteText");
const quoteAuthorEl = document.getElementById("quoteAuthor");
const unsplashCreditEl = document.getElementById("unsplashCredit");

// 4. Calculate “quote of the day” index using days since Unix epoch
function getDayIndex(totalQuotes) {
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  return daysSinceEpoch % totalQuotes;
}

// 5. Pick a random keyword from IMAGE_KEYWORDS
function pickRandomKeyword() {
  const idx = Math.floor(Math.random() * IMAGE_KEYWORDS.length);
  return IMAGE_KEYWORDS[idx];
}

// 6. Set background image using Unsplash Source API (no API key needed)
function setBackgroundImage(keyword) {
  // Unsplash Source URL with desired resolution (3840×2160)
  const url = `https://source.unsplash.com/3840x2160/?${encodeURIComponent(
    keyword
  )}`;
  // Append timestamp to bust any aggressive cache
  document.body.style.backgroundImage = `url("${url}&${Date.now()}")`;
}

// 7. Fetch quotes.json and display the quote + background
fetch(QUOTES_URL)
  .then((response) => {
    if (!response.ok) {
      throw new Error("Failed to load quotes.json");
    }
    return response.json();
  })
  .then((quotesArray) => {
    if (!Array.isArray(quotesArray) || quotesArray.length === 0) {
      quoteTextEl.textContent = "No quotes available.";
      quoteAuthorEl.textContent = "";
      return;
    }

    // 7a) Select “quote of the day”
    const todayIndex = getDayIndex(quotesArray.length);
    const { text, author } = quotesArray[todayIndex];
    quoteTextEl.textContent = `"${text}"`;
    quoteAuthorEl.textContent = author ? `— ${author}` : "— Anon";

    // 7b) Pick a random keyword and set background
    const keyword = pickRandomKeyword();
    setBackgroundImage(keyword);

    // 7c) We’re using the Unsplash Source API, which doesn’t provide metadata in this flow.
    //      If you want to credit photographers, switch to the Unsplash JSON API and handle attribution separately.
    unsplashCreditEl.textContent = "";
  })
  .catch((err) => {
    console.error(err);
    quoteTextEl.textContent = "Error loading quote";
    quoteAuthorEl.textContent = "";
    // Fallback: solid pastel gradient if fetch fails
    document.body.style.backgroundImage =
      "linear-gradient(135deg, #A3BFFA 0%, #667EEA 100%)";
  });
