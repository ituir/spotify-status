import { kv } from "@vercel/kv";

const KV_KEY = "spotify_refresh_token";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // KV is the source of truth; env var seeds it on first run
  let refreshToken =
    (await kv.get(KV_KEY)) ?? process.env.SPOTIFY_REFRESH_TOKEN;

  if (!refreshToken) {
    return res.status(503).json({ error: "No refresh token configured" });
  }

  // Exchange for access token
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     process.env.SPOTIFY_CLIENT_ID,
    }),
  });

  if (!tokenRes.ok) {
    return res.status(503).json({ error: "Token refresh failed" });
  }

  const tokenData   = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Spotify may rotate the refresh token — always persist the latest
  if (tokenData.refresh_token) {
    await kv.set(KV_KEY, tokenData.refresh_token);
  }

  // Fetch currently playing
  const npRes = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=10");

  if (npRes.status === 204) {
    return res.status(200).json({ is_playing: false });
  }

  if (!npRes.ok) {
    return res.status(500).json({ error: "Spotify API error" });
  }

  const data = await npRes.json();
  if (!data?.item) return res.status(200).json({ is_playing: false });

  const item = data.item;
  return res.status(200).json({
    is_playing:  data.is_playing,
    progress_ms: data.progress_ms ?? 0,
    track: {
      name:        item.name,
      artist:      item.artists.map((a) => a.name).join(", "),
      album:       item.album.name,
      image:       item.album.images?.[0]?.url ?? null,
      url:         item.external_urls?.spotify ?? null,
      duration_ms: item.duration_ms,
    },
  });
}
