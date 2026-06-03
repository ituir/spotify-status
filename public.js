// State
let currentId = null;
let localMs = 0;
let tickId = null;
let lyrics = [];
let lyricIdx = -1;
let lyricTrackId = null;
let lyricsBuilt = false;
let bgSlot = "a";

// ---- Utilities ----

function msToTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function parseLRC(text) {
  const lines = text.split("\n");
  const result = [];
  const timeRe = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  for (const line of lines) {
    const matches = [...line.matchAll(timeRe)];
    if (!matches.length) continue;
    const text = line.replace(timeRe, "").trim();
    for (const m of matches) {
      const ms =
        parseInt(m[1]) * 60000 +
        parseInt(m[2]) * 1000 +
        (m[3].length === 2 ? parseInt(m[3]) * 10 : parseInt(m[3]));
      result.push({ ms, text });
    }
  }
  result.sort((a, b) => a.ms - b.ms);
  return result;
}

function parsePlain(text) {
  return text
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ ms: null, text: t }));
}

// ---- Background crossfade ----

function crossfadeBg(url) {
  const next = bgSlot === "a" ? "b" : "a";
  const nextEl = document.getElementById(`bg-${next}`);
  const currEl = document.getElementById(`bg-${bgSlot}`);
  nextEl.style.backgroundImage = `url(${url})`;
  nextEl.style.opacity = "1";
  currEl.style.opacity = "0";
  bgSlot = next;
}

// ---- Marquee ----

function applyMarquee(wrapperId, textId) {
  const wrapper = document.getElementById(wrapperId);
  const text = document.getElementById(textId);
  if (!wrapper || !text) return;
  // Reset first
  text.classList.remove("scrolling");
  text.textContent = text.textContent.split(" • ")[0];

  requestAnimationFrame(() => {
    if (text.scrollWidth > wrapper.clientWidth) {
      const original = text.textContent;
      text.textContent = original + " • " + original;
      text.classList.add("scrolling");
    }
  });
}

// ---- Lyrics ----

function buildLyricsDOM() {
  const scroll = document.getElementById("lyrics-scroll");
  scroll.innerHTML = "";
  for (let i = 0; i < lyrics.length; i++) {
    const div = document.createElement("div");
    div.className = "lyric-line upcoming";
    div.textContent = lyrics[i].text;
    scroll.appendChild(div);
  }
  lyricsBuilt = true;
  lyricIdx = -1;
}

function updateLyricLine(ms) {
  if (!lyricsBuilt || !lyrics.length) return;
  const lines = document.querySelectorAll("#lyrics-scroll .lyric-line");
  if (!lines.length) return;

  // For unsynced lyrics (ms === null), skip scroll logic
  const synced = lyrics[0].ms !== null;
  if (!synced) return;

  let newIdx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].ms <= ms) newIdx = i;
    else break;
  }

  if (newIdx === lyricIdx) return;
  lyricIdx = newIdx;

  lines.forEach((el, i) => {
    el.classList.remove("active", "past", "upcoming");
    if (i < lyricIdx) el.classList.add("past");
    else if (i === lyricIdx) el.classList.add("active");
    else el.classList.add("upcoming");
  });

  const active = lines[lyricIdx];
  if (active) {
    const overlay = document.getElementById("lyrics-overlay");
    const overlayMid = overlay.clientHeight / 2;
    const lineTop = active.offsetTop;
    const lineHalf = active.clientHeight / 2;
    overlay.scrollTop = lineTop - overlayMid + lineHalf;
  }
}

function clearLyrics() {
  const scroll = document.getElementById("lyrics-scroll");
  scroll.innerHTML = "";
  lyrics = [];
  lyricIdx = -1;
  lyricTrackId = null;
  lyricsBuilt = false;
}

async function fetchLyrics(track) {
  const key = track.name + track.artist;
  if (lyricTrackId === key) return;
  lyricTrackId = key;
  clearLyrics();

  const params = new URLSearchParams({
    track_name: track.name,
    artist_name: track.artist,
    album_name: track.album,
    duration: Math.round(track.duration_ms / 1000),
  });

  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (!res.ok) return;
    const data = await res.json();

    if (data.syncedLyrics) {
      lyrics = parseLRC(data.syncedLyrics);
    } else if (data.plainLyrics) {
      lyrics = parsePlain(data.plainLyrics);
    } else {
      return;
    }

    buildLyricsDOM();
    updateLyricLine(localMs);
  } catch (e) {
    // Lyrics unavailable — no-op
  }
}

// ---- Progress ----

function updateProgress(durationMs) {
  const fill = document.getElementById("progress-fill");
  const progressTime = document.getElementById("progress-time");
  const durationTime = document.getElementById("duration-time");

  const pct = durationMs > 0 ? Math.min(localMs / durationMs, 1) * 100 : 0;
  fill.style.width = `${pct}%`;
  progressTime.textContent = msToTime(localMs);
  durationTime.textContent = msToTime(durationMs);

  updateLyricLine(localMs);
}

// ---- Render ----

function renderIdle() {
  document.getElementById("playing").style.display = "none";
  document.getElementById("not-playing").style.display = "";
  clearLyrics();
  document.title = "Spotify Status";
  if (tickId) {
    clearInterval(tickId);
    tickId = null;
  }
}

function renderTrack(data) {
  document.getElementById("playing").style.display = "";
  document.getElementById("not-playing").style.display = "none";

  const track = data.track;
  const trackKey = track.name + track.artist;

  if (trackKey !== currentId) {
    currentId = trackKey;

    document.getElementById("track-name").textContent = track.name;
    document.getElementById("artist-name").textContent = track.artist;
    document.getElementById("album-name").textContent = track.album;

    const link = document.getElementById("spotify-link");
    link.href = track.url || "#";

    const art = document.getElementById("album-art");
    art.src = track.image || "";

    if (track.image) crossfadeBg(track.image);

    document.title = `${track.name} — ${track.artist}`;

    fetchLyrics(track);

    requestAnimationFrame(() => {
      applyMarquee("track-name-wrapper", "track-name");
      applyMarquee("artist-name-wrapper", "artist-name");
      applyMarquee("album-name-wrapper", "album-name");
    });
  }

  localMs = data.progress_ms || 0;

  const disc = document.getElementById("disc");
  const bars = document.getElementById("bars");

  if (data.is_playing) {
    disc.classList.add("spinning");
    disc.classList.remove("paused");
    if (bars) bars.classList.remove("hidden");
  } else {
    disc.classList.add("paused");
    disc.classList.remove("spinning");
    if (bars) bars.classList.add("hidden");
  }

  updateProgress(track.duration_ms);

  if (tickId) clearInterval(tickId);
  tickId = null;

  if (data.is_playing) {
    tickId = setInterval(() => {
      localMs += 1000;
      updateProgress(track.duration_ms);
    }, 1000);
  }
}

// ---- Fetch ----

async function fetchNowPlaying() {
  try {
    const res = await fetch(PUBLIC_CONFIG.apiUrl);
    if (!res.ok) {
      renderIdle();
      return;
    }
    const data = await res.json();
    if (data.is_playing) {
      renderTrack(data);
    } else {
      renderIdle();
    }
  } catch (e) {
    renderIdle();
  }
}

// ---- Init ----

document.getElementById("playing").style.display = "none";
document.getElementById("not-playing").style.display = "";

fetchNowPlaying();
setInterval(fetchNowPlaying, 30000);
