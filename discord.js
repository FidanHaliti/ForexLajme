import axios from "axios";

export function discordWebhookUrl(value) {
  try {
    const url = new URL(value?.trim());
    if (url.protocol !== "https:" ||
        !["discord.com", "discordapp.com"].includes(url.hostname) ||
        url.username || url.password || url.port ||
        !/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      throw new Error();
    }
    url.searchParams.set("wait", "true");
    return url.toString();
  } catch {
    throw new Error("DISCORD_WEBHOOK_URL mungon ose eshte i pavlefshem. Kontrollo GitHub Secret ose .env lokal.");
  }
}

export function splitDiscordMessage(text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 2000) {
    const newline = remaining.lastIndexOf("\n", 1999);
    let end = newline > 0 ? newline + 1 : 2000;
    // Keep emoji surrogate pairs together at the message boundary.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendDiscord(text, webhookUrl) {
  const url = discordWebhookUrl(webhookUrl);
  if (!text.trim()) return;
  const chunks = splitDiscordMessage(`@everyone\n${text}`);
  for (const [index, content] of chunks.entries()) {
    try {
      await axios.post(url, {
        content,
        allowed_mentions: { parse: index === 0 ? ["everyone"] : [] },
      }, { timeout: 20000, maxRedirects: 0 });
    } catch (error) {
      // Axios errors can contain the secret URL; never forward the raw error.
      const status = error.response?.status;
      throw new Error(`Dergimi ne Discord deshtoi${status ? ` (HTTP ${status})` : " (rrjeti ose timeout)"}.`);
    }
  }
}
