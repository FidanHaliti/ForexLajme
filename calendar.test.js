import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DateTime } from "luxon";
import cron from "node-cron";
import { WEEKLY_CRON, DAILY_CRON, reportDates, feedCoversWeek, buildReport } from "./calendar.js";

const date = iso => DateTime.fromISO(iso, { zone: "Europe/Belgrade" });
const event = (day, title = "CPI", impact = "High", time = "12:30pm") => ({
  date: { cdata: day }, title: { cdata: title }, impact: { cdata: impact },
  time: { cdata: time }, country: { cdata: "USD" },
});

test("Sunday weekly report covers only the coming Monday through Friday", () => {
  const days = reportDates("weekly", date("2026-10-25T21:00"));
  assert.deepEqual(days.map(d => d.toISODate()), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
});

test("daily reports cover tomorrow and skip Saturday and Sunday", () => {
  for (let day = 26; day <= 29; day++) {
    assert.equal(reportDates("daily", date(`2026-10-${day}T22:00`))[0].day, day + 1);
  }
  assert.deepEqual(reportDates("daily", date("2026-10-30T22:00")), []);
  assert.deepEqual(reportDates("daily", date("2026-10-31T22:00")), []);
});

test("delayed scheduled runs remain anchored to the intended evening", () => {
  assert.equal(
    reportDates("daily", date("2026-10-30T01:35"), true)[0].toISODate(),
    "2026-10-30"
  );
  assert.deepEqual(
    reportDates("daily", date("2026-10-31T01:35"), true),
    []
  );
  assert.equal(
    reportDates("weekly", date("2026-10-26T01:35"), true)[0].toISODate(),
    "2026-10-26"
  );
});

test("week dates cross year boundaries and daylight saving changes", () => {
  assert.equal(reportDates("weekly", date("2026-12-27T21:00")).at(-1).toISODate(), "2027-01-01");
  for (const sunday of ["2026-03-29T21:00", "2026-10-25T21:00"]) {
    const days = reportDates("weekly", date(sunday));
    assert.deepEqual(days.map(d => d.weekday), [1, 2, 3, 4, 5]);
    assert.ok(days.every(d => d.hour === 0));
  }
  assert.ok(cron.validate(WEEKLY_CRON));
  assert.ok(cron.validate(DAILY_CRON));
  assert.equal(WEEKLY_CRON, "0 21 * * 0");
  assert.equal(DAILY_CRON, "0 22 * * 1-4");
});

test("weekly report groups high impact and holidays and excludes weekends and low impact", () => {
  const days = reportDates("weekly", date("2026-10-25T21:00"));
  const events = [event("10-26-2026"), event("10-27-2026", "Bank Holiday", "Holiday", "All Day"),
    event("10-28-2026", "Low item", "Low"), event("10-31-2026", "Saturday item"), event("11-01-2026", "Sunday item")];
  const text = buildReport(events, "weekly", days);
  assert.ok(text.includes("13:30 | USD | CPI"));
  assert.ok(text.includes("Gjithe diten | USD | Pushim bankar"));
  assert.ok(!/Low item|Saturday item|Sunday item/.test(text));
  assert.equal((text.match(/Nuk ka evente/g) || []).length, 3);
  assert.equal((text.match(/\*\*(?:Hene|Marte|Merkure|Enjte|Premte) -/g) || []).length, 5);
  const daily = buildReport(events, "daily", reportDates("daily", date("2026-10-26T22:00")));
  assert.ok(daily.includes("Pushim bankar"));
  assert.ok(!daily.includes("CPI"));
});

test("stale and invalid feeds are not mistaken for an empty calendar", () => {
  const days = reportDates("weekly", date("2026-10-25T21:00"));
  assert.equal(feedCoversWeek([], days), false);
  assert.equal(feedCoversWeek([event("10-23-2026")], days), false);
  assert.equal(feedCoversWeek([event("bad date")], days), false);
  assert.equal(feedCoversWeek([event("10-26-2026", "Low", "Low")], days), true);
  assert.throws(() => reportDates("invalid", date("2026-10-25")));
});

test("entry point sends weekly/daily reports, skips weekends, and fails on delivery or stale data", () => {
  for (const scenario of ["weekly", "daily", "delayed", "weekend", "failed", "stale"]) {
    const script = `
      import axios from 'axios';
      import { Settings, DateTime } from 'luxon';
      const scenario = ${JSON.stringify(scenario)};
      const fixed = scenario === 'weekly' ? '2026-10-25T21:00' : scenario === 'weekend' ? '2026-10-31T01:35' : scenario === 'delayed' ? '2026-10-30T01:35' : '2026-10-26T22:00';
      const ms = DateTime.fromISO(fixed, {zone:'Europe/Belgrade'}).toMillis();
      Settings.now = () => ms;
      axios.get = async () => ({data:Buffer.from('<weeklyevents><event><title>CPI</title><country>USD</country><date>' + (scenario === 'stale' ? '10-20-2025' : scenario === 'delayed' ? '10-30-2026' : '10-27-2026') + '</date><time>12:30pm</time><impact>High</impact></event></weeklyevents>')});
      axios.post = async (url, body) => {
        if (scenario === 'failed') throw {response:{status:401}};
        console.log('TEST_MESSAGE:' + body.content);
        return {status:200};
      };
      await import('./index.js');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: new URL(".", import.meta.url), encoding: "utf8", timeout: 15000,
      env: { ...process.env, DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/test-placeholder",
        ONE_SHOT: "1", RUN_NOW: "0", NEWS_MODE: scenario === "weekly" ? "weekly" : "daily",
        SCHEDULED_RUN: ["delayed", "weekend"].includes(scenario) ? "1" : "0",
        TIMEZONE: "Europe/Belgrade", TIME_FIX_MINUTES: "0" },
    });
    assert.equal(result.status, ["failed", "stale"].includes(scenario) ? 1 : 0, result.stderr);
    if (["weekly", "daily", "delayed"].includes(scenario)) {
      assert.equal((result.stdout.match(/TEST_MESSAGE:/g) || []).length, 1);
      assert.ok(result.stdout.includes("@everyone"));
      assert.ok(result.stdout.includes(scenario === "weekly" ? "Lajmet javore" : "Lajmet per neser"));
    } else assert.ok(!result.stdout.includes("TEST_MESSAGE:"));
  }
});
