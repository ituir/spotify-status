# Spotify Status Page

A minimal, beautiful page that shows what you're currently listening to on Spotify. No backend required — runs entirely in the browser using Spotify's PKCE OAuth flow.

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create app**
3. Fill in any name and description
4. Set **Redirect URI** to your GitHub Pages URL:
   `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`
   *(trailing slash must match exactly)*
5. Save — then copy your **Client ID**

### 2. Configure `config.js`

Open `config.js` and paste your Client ID:

```js
clientId: "paste_your_client_id_here",
```

The `redirectUri` auto-detects the current page URL, so you don't need to change it.

### 3. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Then in your repo on GitHub: **Settings → Pages → Source → main branch → Save**

Your site will be live at `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`.

### 4. Connect your Spotify account

Visit your GitHub Pages URL, click **Connect with Spotify**, and authorize the app. It will remember your session and auto-refresh the token.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure |
| `style.css` | Styling & animations |
| `app.js` | Spotify auth + API polling |
| `config.js` | Your Client ID (edit this) |
