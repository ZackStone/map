# Map

A lightweight, offline-first map app for tagging and tracking points of interest on a property or any area. Built with Leaflet.js, runs entirely in the browser — no server, no database, no account required.

## Features

- **Pin management** — add, edit, and delete georeferenced pins directly on the map
- **Tag system** — categorize pins with color-coded, emoji-tagged groups; fully customizable
- **Offline-first PWA** — works without internet after the first visit; map tiles are cached as you browse
- **GPS** — real-time location tracking with accuracy circle
- **Import / Export** — transfer your full dataset (pins, boundary, tags, display settings) as a single JSON file
- **Satellite imagery** — Google Satellite, Esri World Imagery, and OpenStreetMap layers
- **Boundary & reserve overlay** — draw and display property boundary and legal reserve polygons
- **Smart initial view** — centers on your pins if data exists, falls back to device GPS, then to a default location
- **Filter & search** — filter pins by tag and search by name; list and map stay in sync

## Stack

- [Leaflet.js](https://leafletjs.com/) — map rendering
- Vanilla JS, HTML, CSS — no frameworks, no build step
- `localStorage` — all data stored in the browser
- Service Worker — offline caching of app shell and map tiles

## Getting started

### GitHub Pages (recommended)

1. Fork or clone this repo
2. Push to your `master` branch
3. Go to **Settings → Pages → Source → GitHub Actions**
4. The site deploys automatically on every push to `master`

Your app will be live at `https://<username>.github.io/<repo>/`

### Local development

Any static file server works. If you have Node.js:

```bash
npx serve public
```

Or open `public/index.html` directly in a browser (`file://` protocol works for basic use).

## Data

All data lives in `localStorage` under these keys:

| Key | Contents |
|-----|----------|
| `map-items` | Array of pins |
| `map-boundary` | Boundary and reserve polygons |
| `map-tags` | Tag definitions (name, color, emoji) |
| `map-display-settings` | Display preferences |

Use **Config → Export** to back up your data as a JSON file, and **Config → Import** to restore it on any device.

### Pin schema

```json
{
  "id": "itm_1234567890_abc12",
  "name": "Pin name",
  "lat": -19.1366,
  "lon": -44.2084,
  "ele": 720.0,
  "time": "2026-06-04T12:00:00Z",
  "tags": ["tag-name"],
  "notes": "",
  "customFields": {}
}
```

### Export file format

```json
{
  "version": 1,
  "exportDate": "2026-06-04T...",
  "items": { "items": [...] },
  "boundary": { "coordinates": [...], "reserve": [...], "points": [...] },
  "tagConfig": { "tag-name": { "color": "#22c55e", "emoji": "🌳" } },
  "displaySettings": { "labelMode": "hover", "fontSize": 12, "pinSize": 1.0, "boundaryMode": "both" }
}
```

## Offline behavior

The service worker pre-caches the full app shell on first load (HTML, JS, CSS, Leaflet). Map tiles are cached on demand as you pan and zoom. After the first online visit, the app is fully functional offline — edits are saved to `localStorage` instantly.
