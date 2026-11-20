# FireLine

One consistent fire record from NASA's MODIS and VIIRS satellites, 2001 to today, in a one-page web app:
a burning calendar for any area, anomalies against the typical year, a 0.1° fire map and CSV downloads.

## Run it

1. Download the app with its data (3 GB):
   **[FireLine on Google Drive](https://drive.google.com/file/d/1wrwv1C1TClSkm8U6fULUNfYjYelBcjWC/view?usp=sharing)**.
   Google Drive warns that it can't scan a file this big for viruses; click "Download anyway".
2. Unzip it (not from inside the zip), then double-click `start.bat` on Windows, or run `python3 app/serve.py` on macOS / Linux.
3. FireLine opens at http://localhost:8765 in Chrome, Edge or Firefox.

The zip holds this code plus the data. If you cloned this repository instead, copy the zip's `data` folder next to `start.bat`.

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
