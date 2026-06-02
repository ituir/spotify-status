// ── PKCE helpers ────────────────────────────────────────────
function randomBase64(len) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function sha256base64(plain) {
  const enc = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── Auth flow ────────────────────────────────────────────────
async function startAuth() {
  if (!SPOTIFY_CONFIG.clientId || SPOTIFY_CONFIG.clientId === "YOUR_CLIENT_ID_HERE") {
    showError("Please set your Spotify Client ID in config.js first.");
    return;
  }
  const verifier = randomBase64(64);
  const challenge = await sha256base64(verifier);
  sessionStorage.setItem("pkce_verifier", verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CONFIG.clientId,
    scope: SPOTIFY_CONFIG.scopes.join(" "),
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = "https://accounts.spotify.com/authorize?" + params;
}

async function handleCallback(code) {
  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier) { showAuthScreen(); return; }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_CONFIG.redirectUri,
      client_id: SPOTIFY_CONFIG.clientId,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    showError("Token exchange failed. Try connecting again.");
    return;
  }

  const data = await res.json();
  saveTokens(data);
  sessionStorage.removeItem("pkce_verifier");
  // Clean the URL so refreshing doesn't replay the code
  history.replaceState({}, "", window.location.pathname);
  startPlayer();
}

// ── Token storage ────────────────────────────────────────────
function saveTokens({ access_token, refresh_token, expires_in }) {
  localStorage.setItem("spotify_access_token", access_token);
  localStorage.setItem("spotify_refresh_token", refresh_token);
  localStorage.setItem("spotify_token_expiry", Date.now() + expires_in * 1000);
}

function getAccessToken() {
  return localStorage.getItem("spotify_access_token");
}

function isTokenExpired() {
  const expiry = localStorage.getItem("spotify_token_expiry");
  return !expiry || Date.now() > Number(expiry) - 30_000;
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("spotify_refresh_token");
  if (!refreshToken) return false;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: SPOTIFY_CONFIG.clientId,
    }),
  });

  if (!res.ok) return false;
  const data = await res.json();
  saveTokens({
    ...data,
    refresh_token: data.refresh_token || refreshToken,
  });
  return true;
}

function disconnect() {
  localStorage.removeItem("spotify_access_token");
  localStorage.removeItem("spotify_refresh_token");
  localStorage.removeItem("spotify_token_expiry");
  clearInterval(pollInterval);
  showAuthScreen();
}

// ── Spotify API ──────────────────────────────────────────────
async function fetchCurrentlyPlaying() {
  if (isTokenExpired()) {
    const ok = await refreshAccessToken();
    if (!ok) { disconnect(); return; }
  }

  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: "Bearer " + getAccessToken() },
  });

  if (res.status === 204 || res.status === 200 && res.headers.get("content-length") === "0") {
    renderNotPlaying();
    return;
  }

  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) { disconnect(); return; }
    return fetchCurrentlyPlaying();
  }

  if (!res.ok) { renderNotPlaying(); return; }

  const data = await res.json();
  if (!data || !data.item) { renderNotPlaying(); return; }
  renderTrack(data);
}

// ── Render ───────────────────────────────────────────────────
let currentTrackId = null;
let localProgress = 0;
let isPlaying = false;
let localTick = null;

function renderTrack(data) {
  const { item, progress_ms, is_playing } = data;

  show("playing");
  hide("not-playing");

  document.getElementById("track-name").textContent = item.name;
  document.getElementById("artist-name").textContent =
    item.artists.map((a) => a.name).join(", ");
  document.getElementById("album-name").textContent = item.album.name;

  const art = item.album.images[0]?.url;
  if (art) document.getElementById("album-art").src = art;

  // Update progress tracking when track changes or on first load
  if (item.id !== currentTrackId) {
    currentTrackId = item.id;
    document.title = `${item.name} — ${item.artists[0].name}`;
    updateBackground(art);
  }

  localProgress = progress_ms;
  isPlaying = is_playing;

  document.getElementById("playing-indicator").style.display =
    is_playing ? "flex" : "none";

  updateProgressUI(item.duration_ms);

  clearInterval(localTick);
  if (is_playing) {
    localTick = setInterval(() => {
      localProgress += 1000;
      updateProgressUI(item.duration_ms);
    }, 1000);
  }
}

function updateProgressUI(duration_ms) {
  const pct = Math.min((localProgress / duration_ms) * 100, 100);
  document.getElementById("progress-bar").style.width = pct + "%";
  document.getElementById("progress-time").textContent = msToTime(localProgress);
  document.getElementById("duration-time").textContent = msToTime(duration_ms);
}

function renderNotPlaying() {
  clearInterval(localTick);
  currentTrackId = null;
  document.title = "Spotify Status";
  show("not-playing");
  hide("playing");
  document.getElementById("progress-bar").style.width = "0%";
  resetBackground();
}

// ── Background accent color ──────────────────────────────────
function updateBackground(imgUrl) {
  if (!imgUrl) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 10;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 10, 10);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    document.body.style.setProperty("--accent", `${r},${g},${b}`);
  };
  img.src = imgUrl;
}

function resetBackground() {
  document.body.style.setProperty("--accent", "30,215,96");
}

// ── Screen management ────────────────────────────────────────
function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }

function showAuthScreen() {
  show("auth-screen");
  hide("player-screen");
  hide("error-screen");
}

function showError(msg) {
  document.getElementById("error-message").textContent = msg;
  hide("auth-screen");
  hide("player-screen");
  show("error-screen");
}

function startPlayer() {
  hide("auth-screen");
  hide("error-screen");
  show("player-screen");
  fetchCurrentlyPlaying();
}

// ── Polling ──────────────────────────────────────────────────
let pollInterval = null;

// ── Init ─────────────────────────────────────────────────────
function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");

  if (error) {
    showError("Spotify authorization was denied.");
    return;
  }

  if (code) {
    await handleCallback(code);
    return;
  }

  if (getAccessToken() && !isTokenExpired()) {
    startPlayer();
    pollInterval = setInterval(fetchCurrentlyPlaying, 5000);
    return;
  }

  if (localStorage.getItem("spotify_refresh_token")) {
    const ok = await refreshAccessToken();
    if (ok) {
      startPlayer();
      pollInterval = setInterval(fetchCurrentlyPlaying, 5000);
      return;
    }
  }

  showAuthScreen();
}

init();
