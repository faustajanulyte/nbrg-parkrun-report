# NBRG parkrun report

A mobile-friendly weekly report generator for North Bristol Running Group. It turns club and athlete results into a reviewable, Facebook-ready roundup containing:

- member and event totals for the selected Saturday
- overall parkrun milestones and single-event milestones
- course PBs (excluding first-time visits)
- all-time PBs
- unusual result coincidences suggested as optional extras
- optional highlights inferred from unusual results and club turnout
- a manually entered moment of the week
- editable highlights and a copy/download workflow

## Run locally

```bash
npm install
npm start
```

Create a production build with `npm run build`.

To test the production web server locally after building:

```bash
npm run start:production
```

## Live data

The app reads North Bristol Running Group's official consolidated club report for the selected date, then checks every listed athlete's complete parkrun history. It derives historical totals as of that Saturday, overall and event-specific milestones, first visits, event PBs and all-time PBs. This avoids using the current total shown on an athlete's summary for an older report.

parkrun protects these pages with a browser challenge. The local development setup opens Chrome while a report is checked; in a container the browser must run in the background. The first run can take a few minutes, and the interface displays a loading status throughout. Athlete histories are cached locally for 12 hours, making repeat checks faster. If parkrun returns an interactive CAPTCHA, the report stops with a clear error because a background browser cannot ask the user to solve it.

Suggested highlights are inferred only from the available results and are never silently added. Each can be included or dismissed before copying the post. Weekly volunteer statistics are not yet extracted because they require collecting each event's separate volunteer roster.

During development, `src/setupProxy.js` attaches the live API to the React development server. In production, `server.js` serves both the built interface and the API from the same port.

## Deploy to Coolify

The repository includes both a `Dockerfile` and `compose.yaml`. The container installs Chromium and runs it in headless mode, so it does not need an X server and no browser window is visible to the person generating a report.

Recommended Coolify setup:

1. Create a new resource from this Git repository.
2. Select **Docker Compose** as the build pack. Coolify will read `compose.yaml`.
3. Assign the application domain to the `nbrg-parkrun-report` service on port `3000`.
4. Deploy. The named `nbrg-parkrun-data` volume preserves the browser session and athlete-history cache.
5. Set the health-check path to `/health` if Coolify does not pick up the image health check automatically.

For a Dockerfile deployment instead, select **Dockerfile**, expose port `3000`, and add persistent storage mounted at `/data` in Coolify. No environment variables are required because the production defaults are included in the image.

The server intentionally permits only one live report extraction at a time. A second request receives a friendly “report already being checked” response instead of opening another 90 browser checks.

Production extraction is deliberately limited to one athlete page at a time with a short delay between pages. This makes the first uncached report slower, but reduces container resource spikes and the chance of triggering parkrun's automated-access protection. `PARKRUN_WORKERS` and `PARKRUN_REQUEST_DELAY_MS` can be adjusted if necessary.

This project is not affiliated with parkrun.
