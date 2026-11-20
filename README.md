# FireLine

One consistent fire record from NASA's MODIS and VIIRS satellites, 2001 to today, in a one-page web app:
a burning calendar for any area, anomalies against the typical year, a 0.1° fire map and CSV downloads.

## Run it

1. Get the processed data and unzip it so that `data/app_data/index.json` sits next to `start.bat`
   (download link: see the repository's Releases).
2. Windows: double-click `start.bat`. macOS / Linux: `python3 app/serve.py`.
3. Open http://localhost:8765 in Chrome, Edge or Firefox.

Needs Python 3.8+ and an internet connection for the background map.

## Code

| Folder | Contents |
|---|---|
| `app/` | The web app: `serve.py` (local server), `index.html`, `style.css`, `data.js`, `charts.js`, `app.js` |
| `harmonize/` | Python scripts that build the harmonized MODIS + VIIRS record and the app's data files |

## Credits

- Fire data: NASA FIRMS (MODIS on Terra and Aqua; VIIRS on Suomi NPP and NOAA-20).
- Map: Leaflet, Esri basemap. Borders: Natural Earth.
- Built by team Paween_and_Kpunn with **Claude Code (Anthropic)**, an AI coding assistant, which wrote most of the code.
