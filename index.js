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
import { WEEKLY_CRON, DAILY_CRON, reportDates, feedCoversWeek, buildReport } from "./calendar.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const envPath = [path.join(directory, ".env"), path.join(directory, "..", ".env")].find(p => fs.existsSync(p));
envConfig(envPath ? { path: envPath } : undefined);

const {
  DISCORD_WEBHOOK_URL,
  TIMEZONE = "Europe/Belgrade",
  RUN_NOW = "0",
  ONE_SHOT = "0",
  NEWS_MODE = "daily",
  SCHEDULED_RUN = "0",
  TIME_FIX_MINUTES = "0",
} = process.env;
const offset = Number.parseInt(TIME_FIX_MINUTES, 10) || 0;

try {
  discordWebhookUrl(DISCORD_WEBHOOK_URL);
  reportDates(NEWS_MODE, DateTime.now().setZone(TIMEZONE), SCHEDULED_RUN === "1");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const feedUrls = [
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

async function fetchEvents(dates) {
  for (const url of feedUrls) {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
        headers: { "User-Agent": "Node FF News" },
      });
      const buffer = Buffer.from(response.data);
      const encoding = /windows-1252/i.test(buffer.toString("ascii", 0, 200)) ? "win1252" : "utf8";
      const data = parser.parse(iconv.decode(buffer, encoding));
      const raw = data?.weeklyevents?.event;
      const events = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!feedCoversWeek(events, dates)) {
        throw new Error("Kalendari nuk permban javen e kerkuar; nuk dergohet raport bosh.");
      }
      return events;
    } catch (error) {
      console.error("Burimi deshtoi:", url, error.message);
    }
  }
  throw new Error("Nuk u sigurua kalendari per javen e kerkuar.");
}

async function job(mode) {
  try {
    // Freeze the report dates once, including across slow network requests.
    const dates = reportDates(mode, DateTime.now().setZone(TIMEZONE), SCHEDULED_RUN === "1");
    if (!dates.length) {
      console.log("SKIP: Nuk dergohen lajme per te shtunen ose te dielen.");
      return true;
    }
    console.log(`JOB ${mode}: ${dates[0].toISODate()} - ${dates.at(-1).toISODate()}`);
    const events = await fetchEvents(dates);
    await sendDiscord(buildReport(events, mode, dates, offset), DISCORD_WEBHOOK_URL);
    console.log("JOB done: Discord");
    return true;
  } catch (error) {
    console.error("JOB error:", error.message);
    return false;
  }
}

if (ONE_SHOT === "1") {
  process.exitCode = await job(NEWS_MODE) ? 0 : 1;
} else {
  cron.schedule(WEEKLY_CRON, () => job("weekly"), { timezone: TIMEZONE });
  cron.schedule(DAILY_CRON, () => job("daily"), { timezone: TIMEZONE });
  console.log(`Orari [${TIMEZONE}]: Diele 21:00 javor; Hene-Enjte 22:00 ditor.`);
  if (RUN_NOW === "1") await job(NEWS_MODE);
}
