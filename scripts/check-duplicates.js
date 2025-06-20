// scripts/check-duplicates.js
const fs = require("fs");
const path = require("path");

// Load the quotes
const quotes = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../quotes.json"), "utf8")
).map((q) => q.text.trim().toLowerCase());

// Detect exact duplicates
const seen = new Set();
console.log("testing")
const dups = new Set();

quotes.forEach((text) => {
  if (seen.has(text)) {
    dups.add(text);
  } else {
    seen.add(text);
  }
});

if (dups.size > 0) {
  // Print a marker + the list, so we can grab it in the Action
  console.log("::duplicate‐quotes-found::\n" + Array.from(dups).join("\n"));
  process.exit(1);
} else {
  console.log("::no‐duplicates::");
  process.exit(0);
}
