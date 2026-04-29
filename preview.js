import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { DateTime } from "luxon";
import iconv from "iconv-lite";

const TZ = "Europe/Belgrade";
const TODAY = DateTime.now().setZone(TZ).toFormat("MM-dd-yyyy");

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

async function fetchXmlJson() {
  for (const url of FF_URLS) {
    try {
      const res = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
      const xml = iconv.decode(Buffer.from(res.data), "win1252");
      return parser.parse(xml);
    } catch (e) {
      console.error("Gabim me", url, e.message);
    }
  }
  throw new Error("S’po e shkarkoj dot FF XML.");
}

function filterTodayRed(events) {
  return events.filter((ev) => {
    const dateStr = (ev.date?.cdata || ev.date || "").toString().trim();
    const impact = (ev.impact?.cdata || ev.impact || "").toString().toLowerCase();
    return dateStr === TODAY && impact.includes("high"); // red flag
  });
}

(async () => {
  try {
    console.log("▶ Sot:", TODAY, `[${TZ}]`);
    const data = await fetchXmlJson();
    const events = asArr(data?.weeklyevents?.event);
    const red = filterTodayRed(events);

    console.log(`🔴 Red-Flag (High Impact) – ${DateTime.now().setZone(TZ).toISODate()}`);
    if (!red.length) {
      console.log("— Nuk ka evente me impakt të lartë sot.");
      return;
    }

    for (const ev of red) {
      const time = (ev.time?.cdata || ev.time || "—").toString();
      const ccy = (ev.country?.cdata || ev.country || "").toString();
      const title = (ev.title?.cdata || ev.title || "").toString();
      const url  = (ev.url?.cdata || ev.url || "").toString();
      console.log(`• ${time} [${ccy}] ${title}`);
      if (url) console.log(`  ↳ ${url}`);
    }
  } catch (err) {
    console.error("❌ Gabim:", err.message);
  }
})();
