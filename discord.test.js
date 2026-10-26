import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { discordWebhookUrl, splitDiscordMessage, sendDiscord } from "./discord.js";

const webhook = "https://discord.com/api/webhooks/123/test-placeholder";

test("validates webhook URLs without exposing their values", () => {
  assert.equal(new URL(discordWebhookUrl(webhook)).searchParams.get("wait"), "true");
  for (const value of [undefined, "", "private-token", "https://discord.com/channels/123/456", "https://example.com/api/webhooks/123/private-token"]) {
    assert.throws(() => discordWebhookUrl(value), error =>
      error.message.includes("DISCORD_WEBHOOK_URL") && !error.message.includes("private-token"));
  }
});

test("splits long messages without losing content or breaking emoji", () => {
  for (const text of ["Short message", "x".repeat(2000), "event\n".repeat(1000), "x".repeat(1999) + "\u{1F534}" + "y".repeat(2200)]) {
    const chunks = splitDiscordMessage(text);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= 2000));
    assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
  }
});

test("mentions everyone only in the first chunk and hides failed request secrets", async (t) => {
  const requests = [];
  t.mock.method(axios, "post", async (url, body, options) => {
    requests.push({ url, body, options });
    return { status: 200 };
  });
  const text = "USD news\n".repeat(400);
  await sendDiscord(text, webhook);
  assert.ok(requests.length > 1);
  assert.equal(requests.map(request => request.body.content).join(""), `@everyone\n${text}`);
  for (const [index, request] of requests.entries()) {
    assert.equal(new URL(request.url).searchParams.get("wait"), "true");
    assert.deepEqual(request.body.allowed_mentions, { parse: index === 0 ? ["everyone"] : [] });
    assert.ok(request.body.content.length <= 2000);
    assert.equal(request.options.timeout, 20000);
  }
  for (const status of [401, 404, 429, 500, undefined]) {
    axios.post.mock.mockImplementation(async () => {
      throw Object.assign(new Error(webhook), { response: { status } });
    });
    await assert.rejects(sendDiscord("news", webhook), error => {
      assert.ok(!error.message.includes(webhook));
      assert.ok(error.message.includes(status ? `HTTP ${status}` : "timeout"));
      return true;
    });
  }
});

test("short news gets one everyone mention; empty news sends nothing", async (t) => {
  const post = t.mock.method(axios, "post", async () => ({ status: 200 }));
  await sendDiscord("", webhook);
  await sendDiscord("  \n", webhook);
  assert.equal(post.mock.callCount(), 0);
  await sendDiscord("Lajmet per neser", webhook);
  assert.equal(post.mock.callCount(), 1);
  const body = post.mock.calls[0].arguments[1];
  assert.equal(body.content, "@everyone\nLajmet per neser");
  assert.deepEqual(body.allowed_mentions, { parse: ["everyone"] });
});
