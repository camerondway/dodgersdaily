# Dodgers Daily Replay

A single-page React application built with Vite and Material UI that finds the previous Los Angeles Dodgers game and plays the condensed broadcast when available.

## Features

- Automatically looks up the Dodgers schedule for the previous Pacific Time calendar day using the MLB Stats API.
- Streams a condensed game highlight with a native HTML5 video player when a direct MP4 feed is exposed.
- Falls back to the official Streamable embed provided for the game when a downloadable stream is unavailable.
- Responsive Material UI layout with Dodgers-inspired theming and typography.

## Getting Started

```bash
npm install
npm run dev
```

The dev server prints the local URL (default `http://localhost:5173`). The page will refresh automatically as you make changes.

## Production Build

```bash
npm run build
npm run preview
```

`npm run build` compiles the application into the `dist` directory. Use `npm run preview` to serve the production bundle locally.

## Deployment (GitHub Pages)

1. Make sure the default branch is `main` and push the latest changes.
2. In GitHub, open **Settings → Pages** and set the source to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds the site with Vite and publishes the `dist` bundle to GitHub Pages each time `main` is updated (or when run manually).
4. Your site will be available at `https://<your-username>.github.io/dodgersdaily/` after the workflow finishes.

## Notes

- The app queries the public MLB Stats API from the browser at runtime. No API key is required.
- If the Dodgers did not play on the previous day or the media feed is not available, the UI explains the situation and offers the provided Streamable embed as a fallback.
