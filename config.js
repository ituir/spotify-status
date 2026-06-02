// ============================================================
//  CONFIGURATION — fill these in before deploying
// ============================================================
const SPOTIFY_CONFIG = {
  // 1. Go to https://developer.spotify.com/dashboard
  // 2. Create an app (any name/description is fine)
  // 3. Copy the Client ID here
  clientId: "8aa6c185264944ff90153d7d7c088112",

  // 4. In your Spotify app's settings, add this exact URL to
  //    "Redirect URIs":  https://YOUR_USERNAME.github.io/YOUR_REPO/
  //    Then paste that same URL below (no trailing slash needed but must match exactly)
  redirectUri: window.location.origin + window.location.pathname,

  // Scopes needed — do not change unless you know what you're doing
  scopes: [
    "user-read-currently-playing",
    "user-read-playback-state",
  ],
};
