// front/index.js — FF High (Red flag) sot → Telegram, Kosovo time, cron @ 08:00

import axios from "axios";
import cron from "node-cron";
import { XMLParser } from "fast-xml-parser";
import { DateTime } from "luxon";
import iconv from "iconv-lite";
import { config as envConfig } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ---- .env nga rrënja ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")].find((p) => fs.existsSync(p));
envConfig(ENV_PATH ? { path: ENV_PATH } : undefined);

// ---- ENV ----
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_CHAT_ID2,
  TIMEZONE = "Europe/Belgrade",
  RUN_NOW,
  CRON, // opsional: lejo përdoruesin të vendosë CRON në .env
  TIME_FIX_MINUTES = "0",   // ⬅️ SHTUAR
} = process.env;

const CHAT_IDS = [TELEGRAM_CHAT_ID, TELEGRAM_CHAT_ID2].filter(Boolean);
const OFFSET_MINUTES = Number.parseInt(TIME_FIX_MINUTES, 10) || 0;

// ---- Guards ----
if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ Mungon TELEGRAM_BOT_TOKEN në .env (rrënja e projektit).");
  process.exit(1);
}
if (CHAT_IDS.length === 0) {
  console.error("❌ Vendos të paktën një nga TELEGRAM_CHAT_ID / TELEGRAM_CHAT_ID2 në .env.");
  process.exit(1);
}

// ---- Boot log minimal ----
console.log(
  `▶ boot | TZ=${TIMEZONE} | RUN_NOW=${RUN_NOW ?? "0"} | CHAT1=${TELEGRAM_CHAT_ID} | CHAT2=${TELEGRAM_CHAT_ID2 || ""}`
);

// ---- FF feeds ----
const FF_URLS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.xml",
  "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.xml",
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: true,
  trimValues: true,
  cdataPropName: "cdata",
});

const asArr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const targetDate = (tz) => DateTime.now().setZone(tz).plus({ days: 1 });
const targetDateStr = (tz) => targetDate(tz).toFormat("MM-dd-yyyy");
const weekdayNames = ["Hene", "Marte", "Merkure", "Enjte", "Premte", "Shtune", "Diele"];
const targetDayName = (tz) => weekdayNames[targetDate(tz).weekday - 1];

// ---- Fetch XML me fallback ----
async function fetchXml() {
  let lastErr;
  for (const url of FF_URLS) {
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
        headers: { "User-Agent": "Node FF RedFlag" },
      });
      return iconv.decode(Buffer.from(res.data), "win1252");
    } catch (e) {
      lastErr = e;
      console.error("✗ Dështoi:", url, "|", e?.message);
    }
  }
  throw lastErr || new Error("S’po e shkarkoj dot FF XML.");
}

// ---- Filtrim: sot + High ----
function filterTodayRed(events, tz) {
  const target = targetDateStr(tz);
  return events.filter((ev) => {
    const dateStr = (ev?.date?.cdata || ev?.date || "").toString().trim();
    const impact = (ev?.impact?.cdata || ev?.impact || "").toString().toLowerCase();
    return dateStr === target && impact.includes("high");
  });
}

// ---- ET → lokale ----
function convertEtToLocal(etTimeStr, tz) {
  if (!etTimeStr) return "—";
  const raw = String(etTimeStr).trim();
  if (!raw || /^(all day|tentative|tba)$/i.test(raw)) return raw;

  const hasAmPm = /am|pm/i.test(raw);
  const fmt = hasAmPm ? "h:mma" : "H:mm";

  const dtEt = DateTime.fromFormat(raw.replace(/\s+/g, ""), fmt, { zone: "America/New_York" });
  if (!dtEt.isValid) return raw;

  // 1) ET → zona jote
  let local = dtEt.setZone(tz);

  // 2) Apliko offset manual nga .env (p.sh. -240 = minus 4 orë)
  const offsetMin = OFFSET_MINUTES;
  if (offsetMin !== 0) {
    local = local.plus({ minutes: offsetMin });
  }

  return local.toFormat("HH:mm");
}


// ---- Mesazhi ----
function buildPlain(events, tz) {
  const ymd = targetDate(tz).toFormat("yyyy-MM-dd");
  const dayName = targetDayName(tz);
  {
    if (!events.length) return `🔴 Lajmet per diten e ${dayName} (${ymd}) [${tz}]:\n- Nuk ka evente me impakt te larte.`;

    const lines = events.map((ev) => {
      const timeEt = (ev?.time?.cdata || ev?.time || "-").toString();
      const timeLocal = convertEtToLocal(timeEt, tz);
      const ccy = (ev?.country?.cdata || ev?.country || "").toString();
      const title = (ev?.title?.cdata || ev?.title || "").toString();
      return `${timeLocal}  ${ccy}  ${title}`;
    });

    return `🔴 Lajmet per diten e ${dayName} (${ymd}) [${tz}]:\n\n` + lines.join("\n");
  }
  if (!events.length) return `🔴 Red-Flag për sot (${ymd}) [${tz}]:\n— Nuk ka evente me impakt të lartë.`;

  const lines = events.map((ev) => {
    const timeEt = (ev?.time?.cdata || ev?.time || "—").toString();
    const timeLocal = convertEtToLocal(timeEt, tz);
    const ccy = (ev?.country?.cdata || ev?.country || "").toString();
    const title = (ev?.title?.cdata || ev?.title || "").toString();
    return `${timeLocal}  ${ccy}  ${title}`;
  });

  return `🔴 Red-Flag për sot (${ymd}) [${tz}]:\n\n` + lines.join("\n");
}

// ---- Telegram ----
async function sendToAll(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  for (const id of CHAT_IDS) {
    try {
      await axios.post(url, { chat_id: id, text, disable_web_page_preview: true }, { timeout: 20000 });
      console.log(`[OK] Dërguar te ${id}`);
    } catch (e) {
      console.error(`[ERR] Dështoi te ${id}:`, e?.response?.data || e?.message || e);
    }
  }
}

// ---- Job ----
async function job() {
  console.log("▶ JOB start", new Date().toISOString());
  try {
    const xml = await fetchXml();
    const json = parser.parse(xml);
    const events = asArr(json?.weeklyevents?.event);
    const todays = filterTodayRed(events, TIMEZONE);
    const msg = buildPlain(todays, TIMEZONE);
    await sendToAll(msg);
    console.log("▶ JOB done");
  } catch (e) {
    console.error("❌ JOB error:", e?.message || e);
  }
}

// ---- Normalizo CRON ----
// Lejojmë .env CRON, por e riparojmë nëse dikush ka futur "08:00"
function normalizeCron(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // nëse është në format orë: "08:00" ose "8:00" → ktheje në fushat cron
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    return `${mm} ${hh} * * *`;
  }
  // nëse është i vlefshëm siç është, ktheje
  if (cron.validate(s)) return s;
  return null;
}

const CRON_EXPR = normalizeCron(CRON) || "0 8 * * *"; // default 08:00 çdo ditë
console.log("⏱ po planifikoj", CRON_EXPR, "@", TIMEZONE);
cron.schedule(CRON_EXPR, job, { timezone: TIMEZONE });

// Test i menjëhershëm
if (String(RUN_NOW || "").trim() === "1") job();

console.log('BUILD_TAG: 20250904-213300')
