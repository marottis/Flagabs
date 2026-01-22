import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(__dirname, "scores.json");
const COUNTRIES_CACHE = path.join(__dirname, "countries.cache.json");

// Fonte: ISO 3166-1 alpha-2 (inclui territórios) em JSON
const ISO_ALPHA2_SOURCE =
  "https://gist.githubusercontent.com/ssskip/5a94bfcd2835bf1dea52/raw/59272a2d1c2122f0cedd83a76780a01d50726d98/ISO3166-1.alpha2.json";

// Injeções extras (pra bater 254 e ficar “estilo game”)
const EXTRA_FLAGS = [
  // UK home nations (códigos estendidos usados em datasets públicos)
  ["gb-eng", "England"],
  ["gb-sct", "Scotland"],
  ["gb-wls", "Wales"],
  ["gb-nir", "Northern Ireland"],

  // extra comum em jogos/flags
  ["eu", "European Union"],
];

function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const db = JSON.parse(raw);
    if (!db || !Array.isArray(db.records)) return { records: [] };
    return db;
  } catch {
    return { records: [] };
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function isBetter(newRec, oldRec) {
  return (
    newRec.score > oldRec.score ||
    (newRec.score === oldRec.score && newRec.time < oldRec.time)
  );
}

// ---- Countries loader (ISO + cache + extras) ----
let countries = [];

function normalizeName(name) {
  return String(name)
    .replace(/\s+/g, " ")
    .trim();
}

function buildCountriesFromMap(alpha2Map) {
  // alpha2Map: { "BR":"Brazil", ... }
  const arr = Object.entries(alpha2Map).map(([code, name]) => [
    String(code).toLowerCase(),
    normalizeName(name),
  ]);

  // Remove códigos obsoletos/indesejados se quiser (ex: "an" Netherlands Antilles)
  const blocked = new Set(["an"]); // opcional: tira o antigo "Netherlands Antilles"
  const filtered = arr.filter(([code]) => !blocked.has(code));

  // adiciona extras se não existirem
  const existing = new Set(filtered.map(([c]) => c));
  for (const [c, n] of EXTRA_FLAGS) {
    if (!existing.has(c)) filtered.push([c, n]);
  }

  // ordena por nome (só pra ficar bonito)
  filtered.sort((a, b) => a[1].localeCompare(b[1], "en"));

  return filtered;
}

async function loadCountries() {
  // 1) tenta cache
  try {
    const cached = JSON.parse(fs.readFileSync(COUNTRIES_CACHE, "utf-8"));
    if (Array.isArray(cached) && cached.length >= 200) {
      countries = cached;
      console.log(`Loaded countries from cache: ${countries.length}`);
      return;
    }
  } catch {
    // ignora
  }

  // 2) baixa da internet (uma vez) e salva cache
  const res = await fetch(ISO_ALPHA2_SOURCE);
  if (!res.ok) throw new Error(`Failed to fetch ISO list: ${res.status}`);
  const alpha2Map = await res.json();

  const built = buildCountriesFromMap(alpha2Map);
  if (!Array.isArray(built) || built.length < 200) {
    throw new Error("Built countries list too small");
  }

  countries = built;
  fs.writeFileSync(COUNTRIES_CACHE, JSON.stringify(countries, null, 2));
  console.log(`Downloaded & cached countries: ${countries.length}`);
}

// ---- API ----
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/countries", (req, res) => {
  res.json(countries);
});

app.get("/ranking", (req, res) => {
  const mode = String(req.query.mode || "classic");
  const date = String(req.query.date || "");

  const db = readDB();
  let list = db.records.filter((r) => (r.mode || "classic") === mode);

  if (mode === "daily") {
    if (!date) return res.json([]);
    list = list.filter((r) => r.date === date);
  }

  list.sort((a, b) => b.score - a.score || a.time - b.time);
  res.json(list.slice(0, 10));
});

app.post("/score", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const score = Number(req.body?.score ?? 0);
  const time = Number(req.body?.time ?? 999999);
  const mode = String(req.body?.mode || "classic");
  const date = req.body?.date == null ? null : String(req.body.date);

  if (!name) return res.status(400).json({ error: "name required" });
  if (!Number.isFinite(score) || score < 0)
    return res.status(400).json({ error: "invalid score" });
  if (!Number.isFinite(time) || time < 0)
    return res.status(400).json({ error: "invalid time" });

  if (mode === "daily" && !date) {
    return res.status(400).json({ error: "daily requires date YYYY-MM-DD" });
  }

  const db = readDB();

  const key =
    mode === "daily"
      ? `${name.toLowerCase()}|daily|${date}`
      : `${name.toLowerCase()}|classic`;

  const candidate = {
    name,
    score,
    time,
    mode,
    date: mode === "daily" ? date : null,
    key,
    createdAt: Date.now(),
  };

  const idx = db.records.findIndex((r) => r.key === key);

  let updated = false;
  if (idx === -1) {
    db.records.push(candidate);
    updated = true;
  } else if (isBetter(candidate, db.records[idx])) {
    db.records[idx] = candidate;
    updated = true;
  }

  writeDB(db);
  res.json({ updated });
});

// ---- Boot ----
(async function boot() {
  try {
    await loadCountries();
    console.log(`Countries ready: ${countries.length}`);
    app.listen(PORT, HOST, () => {
      console.log(`Flagzim backend running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
