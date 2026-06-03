// ── Lyrics ────────────────────────────────────────────────────
let lyrics        = [];
let lyricIdx      = -1;
let lyricTrackId  = null;
let lyricsBuilt   = false;

async function fetchLyrics(trackName, artistName, albumName, durationSec) {
  const params = new URLSearchParams({
    track_name:  trackName,
    artist_name: artistName,
    album_name:  albumName,
    duration:    Math.round(durationSec),
  });
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (!res.ok) { clearLyrics(); return; }
    const data = await res.json();
    const raw  = data.syncedLyrics || data.plainLyrics || "";
    if (!raw) { clearLyrics(); return; }
    lyrics = data.syncedLyrics ? parseLRC(raw) : parsePlain(raw);
    buildLyricsDOM();
  } catch { clearLyrics(); }
}

function parseLRC(lrc) {
  return lrc.split("\n")
    .map(line => {
      const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
      if (!m) return null;
      return { ms: (parseInt(m[1]) * 60 + parseFloat(m[2])) * 1000, text: m[3].trim() };
    })
    .filter(l => l && l.text)
    .sort((a, b) => a.ms - b.ms);
}

function parsePlain(plain) {
  const lines = plain.split("\n").map(t => t.trim()).filter(Boolean);
  return lines.map((text, i) => ({ ms: i * 4000, text }));
}

function buildLyricsDOM() {
  const scroll = document.getElementById("lyrics-scroll");
  const empty  = document.getElementById("lyrics-empty");
  scroll.innerHTML = "";

  if (!lyrics.length) {
    empty.classList.remove("hidden");
    lyricsBuilt = false;
    return;
  }

  empty.classList.add("hidden");
  lyrics.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "lyric-line";
    div.dataset.i  = i;
    div.textContent = line.text;
    scroll.appendChild(div);
  });
  lyricsBuilt = true;
  lyricIdx = -1;
}

function updateLyricLine(ms) {
  if (!lyricsBuilt || !lyrics.length) return;

  let idx = 0;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].ms <= ms) idx = i;
    else break;
  }

  if (idx === lyricIdx) return;
  lyricIdx = idx;

  const overlay = document.getElementById("lyrics-overlay");
  const scroll  = document.getElementById("lyrics-scroll");
  const lines   = scroll.querySelectorAll(".lyric-line");

  lines.forEach((el, i) => {
    el.classList.remove("past", "upcoming", "active");
    if (i < idx)  el.classList.add("past");
    if (i === idx) el.classList.add("active");
    if (i > idx)  el.classList.add("upcoming");
  });

  // Scroll current line to vertical centre of the overlay
  const active = lines[idx];
  if (active) {
    const overlayH = overlay.clientHeight;
    const lineTop  = active.offsetTop;
    const lineH    = active.clientHeight;
    overlay.scrollTo({ top: lineTop - overlayH / 2 + lineH / 2, behavior: "smooth" });
  }
}

function clearLyrics() {
  lyrics = []; lyricIdx = -1; lyricsBuilt = false;
  document.getElementById("lyrics-scroll").innerHTML = "";
  document.getElementById("lyrics-empty").classList.add("hidden");
}

// ── PKCE helpers ──────────────────────────────────────────────
function randomBase64(len) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function sha256base64(plain) {
  const enc  = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── Auth ──────────────────────────────────────────────────────
async function startAuth() {
  if (!SPOTIFY_CONFIG.clientId || SPOTIFY_CONFIG.clientId === "YOUR_CLIENT_ID_HERE") {
    showError("Set your Spotify Client ID in config.js first.");
    return;
  }
  const verifier  = randomBase64(64);
  const challenge = await sha256base64(verifier);
  sessionStorage.setItem("pkce_verifier", verifier);

  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             SPOTIFY_CONFIG.clientId,
    scope:                 SPOTIFY_CONFIG.scopes.join(" "),
    redirect_uri:          SPOTIFY_CONFIG.redirectUri,
    code_challenge_method: "S256",
    code_challenge:        challenge,
  });
  window.location.href = "https://accounts.spotify.com/authorize?" + params;
}

async function handleCallback(code) {
  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier) { startAuth(); return; }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  SPOTIFY_CONFIG.redirectUri,
      client_id:     SPOTIFY_CONFIG.clientId,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) { showError("Token exchange failed. Retrying…"); setTimeout(startAuth, 2000); return; }
  saveTokens(await res.json());
  sessionStorage.removeItem("pkce_verifier");
  history.replaceState({}, "", window.location.pathname);
  startPlayer();
}

// ── Token storage ─────────────────────────────────────────────
function saveTokens({ access_token, refresh_token, expires_in }) {
  localStorage.setItem("sp_at",  access_token);
  localStorage.setItem("sp_rt",  refresh_token);
  localStorage.setItem("sp_exp", Date.now() + expires_in * 1000);
}

const getToken  = () => localStorage.getItem("sp_at");
const isExpired = () => Date.now() > Number(localStorage.getItem("sp_exp")) - 30_000;

async function refreshToken() {
  const rt = localStorage.getItem("sp_rt");
  if (!rt) return false;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: rt,
      client_id:     SPOTIFY_CONFIG.clientId,
    }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  saveTokens({ ...data, refresh_token: data.refresh_token || rt });
  return true;
}

// ── Spotify API ───────────────────────────────────────────────
async function fetchNowPlaying() {
  if (isExpired()) {
    if (!await refreshToken()) { startAuth(); return; }
  }

  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: "Bearer " + getToken() },
  });

  if (res.status === 204) { renderIdle(); return; }
  if (res.status === 401) {
    if (!await refreshToken()) { startAuth(); return; }
    return fetchNowPlaying();
  }
  if (!res.ok) { renderIdle(); return; }

  const data = await res.json();
  if (!data?.item) { renderIdle(); return; }
  renderTrack(data);
}

// ── Render ────────────────────────────────────────────────────
let currentId = null;
let localMs   = 0;
let tickId    = null;

function renderTrack({ item, progress_ms, is_playing }) {
  hide("not-playing"); show("playing");

  if (item.id !== currentId) {
    ["track-wrap", "artist-wrap"].forEach(id =>
      document.getElementById(id).classList.remove("scrolling")
    );
    setText("track-name",  item.name);
    setText("artist-name", item.artists.map(a => a.name).join(", "));
    setText("album-name",  item.album.name);

    document.getElementById("spotify-link").href = item.external_urls?.spotify || "#";

    const art = item.album.images[0]?.url;
    if (art) { document.getElementById("album-art").src = art; crossfadeBg(art); }

    document.title = `${item.name} — ${item.artists[0].name}`;
    currentId = item.id;

    if (lyricTrackId !== item.id) {
      lyricTrackId = item.id;
      clearLyrics();
      fetchLyrics(item.name, item.artists[0].name, item.album.name, item.duration_ms / 1000);
    }

    requestAnimationFrame(() => {
      applyMarquee("track-wrap",  "track-name");
      applyMarquee("artist-wrap", "artist-name");
    });
  }

  localMs = progress_ms;

  const disc = document.getElementById("disc");
  disc.classList.toggle("spinning", is_playing);
  disc.classList.toggle("paused",   !is_playing);
  document.getElementById("bars").classList.toggle("hidden", !is_playing);

  updateProgress(item.duration_ms);
  clearInterval(tickId);
  if (is_playing) {
    tickId = setInterval(() => { localMs += 1000; updateProgress(item.duration_ms); }, 1000);
  }
}

function updateProgress(durationMs) {
  const pct = Math.min((localMs / durationMs) * 100, 100);
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-time").textContent = msToTime(localMs);
  document.getElementById("duration-time").textContent = msToTime(durationMs);
  updateLyricLine(localMs);
}

function renderIdle() {
  clearInterval(tickId);
  currentId = null; lyricTrackId = null;
  document.title = "Spotify Status";
  hide("playing"); show("not-playing");
  document.getElementById("progress-fill").style.width = "0%";
  clearLyrics();
}

// ── Marquee ───────────────────────────────────────────────────
function applyMarquee(wrapperId, textId) {
  const wrap = document.getElementById(wrapperId);
  const text = document.getElementById(textId);
  if (text.scrollWidth > wrap.clientWidth + 2 && !wrap.classList.contains("scrolling")) {
    text.textContent = text.textContent + "      " + text.textContent;
    wrap.classList.add("scrolling");
  } else if (text.scrollWidth <= wrap.clientWidth + 2) {
    wrap.classList.remove("scrolling");
  }
}

// ── Background crossfade ──────────────────────────────────────
let bgSlot = "a";

function crossfadeBg(url) {
  const next    = bgSlot === "a" ? "b" : "a";
  const nextEl  = document.getElementById("bg-" + next);
  const currEl  = document.getElementById("bg-" + bgSlot);
  nextEl.style.backgroundImage = `url(${url})`;
  nextEl.style.opacity = "1";
  currEl.style.opacity = "0";
  bgSlot = next;
}

// ── Screen helpers ────────────────────────────────────────────
const show    = id => document.getElementById(id)?.classList.remove("hidden");
const hide    = id => document.getElementById(id)?.classList.add("hidden");
const setText = (id, val) => { document.getElementById(id).textContent = val; };

function showError(msg) {
  document.getElementById("error-message").textContent = msg;
  hide("loading-screen"); hide("player-screen"); show("error-screen");
}

// ── Player start ──────────────────────────────────────────────
let pollId = null;

function startPlayer() {
  hide("loading-screen"); hide("error-screen"); show("player-screen");
  fetchNowPlaying();
  pollId = setInterval(fetchNowPlaying, 5000);
}

// ── Utils ─────────────────────────────────────────────────────
function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Init — auto-connect, no button needed ─────────────────────
async function init() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get("code");
  const error  = params.get("error");

  if (error) { showError("Spotify authorization was denied."); return; }
  if (code)  { await handleCallback(code); return; }

  if (getToken() && !isExpired()) { startPlayer(); return; }

  if (localStorage.getItem("sp_rt")) {
    if (await refreshToken()) { startPlayer(); return; }
  }

  // No token — automatically redirect to Spotify
  startAuth();
}

init();
