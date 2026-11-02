import { DateTime } from "luxon";
import { reportDates } from "./calendar.js";

const mode = process.env.NEWS_MODE || "daily";
const zone = process.env.TIMEZONE || "Europe/Belgrade";
const scheduled = process.env.SCHEDULED_RUN === "1";
const dates = reportDates(mode, DateTime.now().setZone(zone), scheduled);

console.log(`send=${dates.length ? "true" : "false"}`);
console.log(`key=${dates.length ? `${mode}-${dates[0].toISODate()}` : `skip-${mode}`}`);
