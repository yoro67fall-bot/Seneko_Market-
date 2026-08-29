#!/usr/bin/env node
/**
 * Writes public/api-config.json from Netlify env vars at build time.
 * Required: RAILWAY_API_URL, COUNTRY
 * Optional: COUNTRY_NAME, FLAG_URL
 */
const fs = require("fs");
const path = require("path");

const apiUrl = String(process.env.RAILWAY_API_URL || "").replace(/\/$/, "");
const country = String(process.env.COUNTRY || "SN").toUpperCase();

const defaults = {
  SN: { countryName: "Sénégal", flagUrl: "/flags/sn.svg" },
  BJ: { countryName: "Bénin", flagUrl: "/flags/bj.svg" },
  TG: { countryName: "Togo", flagUrl: "/flags/tg.svg" },
  CD: { countryName: "RDC", flagUrl: "/flags/cd.svg" }
};

if (!apiUrl) {
  console.error("RAILWAY_API_URL is required.");
  process.exit(1);
}

if (!defaults[country]) {
  console.error(`COUNTRY must be one of: SN, BJ, TG, CD (got: ${country})`);
  process.exit(1);
}

const config = {
  apiUrl,
  country,
  countryName: process.env.COUNTRY_NAME || defaults[country].countryName,
  flagUrl: process.env.FLAG_URL || defaults[country].flagUrl
};

const publicDir = path.join(__dirname, "..", "public");
const outJson = path.join(publicDir, "api-config.json");
fs.writeFileSync(outJson, JSON.stringify(config, null, 2) + "\n");
console.log("Wrote api-config.json:", config);
