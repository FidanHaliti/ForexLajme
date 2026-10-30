import { DateTime } from "luxon";

export const WEEKLY_CRON = "0 21 * * 0";
export const DAILY_CRON = "0 22 * * 1-4";
const weekdays = ["Hene", "Marte", "Merkure", "Enjte", "Premte"];
const value = (event, key) => String(event?.[key]?.cdata ?? event?.[key] ?? "").trim();

export function reportDates(mode, now, scheduledRun = false) {
  if (!["weekly", "daily"].includes(mode)) throw new Error("NEWS_MODE duhet te jete daily ose weekly.");
  if (!now.isValid) throw new Error("TIMEZONE ose data eshte e pavlefshme.");
  // GitHub Actions may start a scheduled run after midnight. Keep that run
  // anchored to the evening on which it was supposed to start.
  const anchor = scheduledRun ? now.minus({ hours: 8 }) : now;
  if (mode === "weekly") {
    const monday = anchor.startOf("day").plus({ days: 8 - anchor.weekday });
    return Array.from({ length: 5 }, (_, index) => monday.plus({ days: index }));
  }
  const tomorrow = anchor.plus({ days: 1 }).startOf("day");
  return tomorrow.weekday <= 5 ? [tomorrow] : [];
}

function eventDate(event, zone) {
  const raw = value(event, "date");
  const date = DateTime.fromFormat(raw, "MM-dd-yyyy", { zone });
  return date.isValid ? date : DateTime.fromISO(raw, { zone });
}

export function feedCoversWeek(events, dates) {
  if (!dates.length) return false;
  const start = dates[0].startOf("week");
  const end = start.plus({ days: 7 });
  return events.some(event => {
    const date = eventDate(event, start.zoneName);
    return date.isValid && date >= start && date < end;
  });
}

function isRelevant(event) {
  return /high/i.test(value(event, "impact")) ||
    /holiday/i.test(value(event, "title") + " " + value(event, "impact")) ||
    value(event, "holiday") === "1";
}

function localTime(event, zone, offset) {
  const raw = value(event, "time");
  if (/^all\s*day$/i.test(raw)) return "Gjithe diten";
  if (!raw || /^(tentative|tba)$/i.test(raw)) return raw || "-";
  const date = eventDate(event, "UTC");
  const time = raw.replace(/\s+/g, "").toUpperCase();
  const format = /AM|PM/.test(time) ? "h:mma" : "H:mm";
  const instant = DateTime.fromFormat(`${date.toISODate()} ${time}`, `yyyy-MM-dd ${format}`, { zone: "UTC" });
  return instant.isValid ? instant.setZone(zone).plus({ minutes: offset }).toFormat("HH:mm") : raw;
}

export function buildReport(events, mode, dates, offset = 0) {
  if (!dates.length) return null;
  const sections = dates.map(date => {
    const selected = events.filter(event =>
      eventDate(event, date.zoneName).toISODate() === date.toISODate() && isRelevant(event));
    const lines = selected.map(event => {
      const title = value(event, "title").replace(/Bank Holiday/gi, "Pushim bankar");
      return `${localTime(event, date.zoneName, offset)} | ${value(event, "country")} | ${title}`;
    });
    return `**${weekdays[date.weekday - 1]} - ${date.toISODate()}**\n` +
      (lines.length ? lines.join("\n") : "Nuk ka evente me impakt te larte apo pushime bankare.");
  });
  const heading = mode === "weekly"
    ? `Lajmet javore: ${dates[0].toISODate()} - ${dates.at(-1).toISODate()}`
    : "Lajmet per neser";
  return `**${heading}**\n\n${sections.join("\n\n")}`;
}
