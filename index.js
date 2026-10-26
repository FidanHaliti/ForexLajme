// ForexFactory High + pushime bankare -> Discord

import axios from "axios";
import cron from "node-cron";
import { XMLParser } from "fast-xml-parser";
import { DateTime } from "luxon";
import iconv from "iconv-lite";
import { config as envConfig } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { discordWebhookUrl, sendDiscord } from "./discord.js";

// ---- .env nga rrënja ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")].find((p) => fs.existsSync(p));
envConfig(ENV_PATH ? { path: ENV_PATH } : undefined);

// ---- ENV ----
const {
  DISCORD_WEBHOOK_URL,
  TIMEZONE = "Europe/Belgrade",
  RUN_NOW,
  ONE_SHOT = "0",
  CRON, // opsional: lejo përdoruesin të vendosë CRON në .env
  TIME_FIX_MINUTES = "0",   // ⬅️ SHTUAR
  TARGET_DAYS = "1",
} = process.env;

const OFFSET_MINUTES = Number.parseInt(TIME_FIX_MINUTES, 10) || 0;
const TARGET_DAYS_AHEAD = Number.parseInt(TARGET_DAYS, 10) || 0;
const ONE_SHOT_MODE = String(ONE_SHOT || "").trim() === "1";

// ---- Guards ----
try {
  discordWebhookUrl(DISCORD_WEBHOOK_URL);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// ---- Boot log minimal ----
console.log(
  `▶ boot | TZ=${TIMEZONE} | RUN_NOW=${RUN_NOW ?? "0"} | DEST=Discord`
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
const targetDate = (tz) => DateTime.now().setZone(tz).plus({ days: TARGET_DAYS_AHEAD });
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

const getEventValue = (ev, key) => (ev?.[key]?.cdata || ev?.[key] || "").toString().trim();

function isBankHoliday(ev) {
  const title = getEventValue(ev, "title").toLowerCase();
  const impact = getEventValue(ev, "impact").toLowerCase();
  const holiday = getEventValue(ev, "holiday").toLowerCase();
  return title.includes("bank holiday") || title.includes("holiday") || impact.includes("holiday") || holiday === "1";
}

function isHighImpact(ev) {
  const impact = getEventValue(ev, "impact").toLowerCase();
  return impact.includes("high");
}

// ---- Filtrim: dita e zgjedhur + High ose Pushim bankar ----
function filterTodayRed(events, tz) {
  const target = targetDateStr(tz);
  return events.filter((ev) => {
    const dateStr = getEventValue(ev, "date");
    return dateStr === target && (isHighImpact(ev) || isBankHoliday(ev));
  });
}

// ---- ET → lokale ----
function convertEtToLocal(etTimeStr, tz) {
  if (!etTimeStr) return "—";
  const raw = String(etTimeStr).trim();
  if (!raw || /^(all day|tentative|tba)$/i.test(raw)) return raw;

  const hasAmPm = /am|pm/i.test(raw);
  const fmt = hasAmPm ? "h:mma" : "H:mm";

  const dtEt = DateTime.fromFormat(raw.replace(/\s+/g, ""), fmt, { zone: "UTC" });
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
    if (!events.length) return `🔴 Lajmet per diten e ${dayName}\n📅 ${ymd}\n\nNuk ka evente me impakt te larte apo pushime bankare.`;

    const lines = events.map((ev) => {
      const timeEt = getEventValue(ev, "time") || "-";
      const timeLocal = /^all day$/i.test(timeEt) ? "Gjithe diten" : convertEtToLocal(timeEt, tz);
      const ccy = getEventValue(ev, "country");
      const title = getEventValue(ev, "title").replace(/Bank Holiday/gi, "Pushim bankar");
      return `${timeLocal} | ${ccy} | ${title}`;
    });

    return `🔴 Lajmet per diten e ${dayName}\n📅 ${ymd}\n\n` + lines.join("\n");
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

// ---- Job ----
async function job() {
  console.log("▶ JOB start", new Date().toISOString());
  try {
    const xml = await fetchXml();
    const json = parser.parse(xml);
    const events = asArr(json?.weeklyevents?.event);
    const todays = filterTodayRed(events, TIMEZONE);
    const msg = buildPlain(todays, TIMEZONE);
    await sendDiscord(msg, DISCORD_WEBHOOK_URL);
    console.log("▶ JOB done");
    return true;
  } catch (e) {
    console.error("❌ JOB error:", e?.message || e);
    return false;
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

if (ONE_SHOT_MODE) {
  job()
    .then((success) => process.exit(success ? 0 : 1))
    .catch(() => process.exit(1));
} else {
  const CRON_EXPR = normalizeCron(CRON) || "0 8 * * *"; // default 08:00 çdo ditë
  console.log("⏱ po planifikoj", CRON_EXPR, "@", TIMEZONE);
  cron.schedule(CRON_EXPR, job, { timezone: TIMEZONE });

  // Test i menjëhershëm
  if (String(RUN_NOW || "").trim() === "1") job();
}

console.log('BUILD_TAG: 20250904-213300')
