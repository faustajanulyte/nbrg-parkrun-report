# NBRG parkrun report

A mobile-friendly weekly report generator for North Bristol Running Group. It turns club and athlete results into a reviewable, Facebook-ready roundup containing:

- member and event totals for the selected parkrun date
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

The app reads North Bristol Running Group's official consolidated club report for the selected date, then checks every listed athlete's complete parkrun history. It derives historical totals as of that date, overall and event-specific milestones, first visits, event PBs and all-time PBs. This avoids using the current total shown on an athlete's summary for an older report. Saturday is the default, but special-event parkruns on other days are supported.

parkrun protects these pages with a browser challenge. The local development setup opens Chrome while a report is checked. If an interactive CAPTCHA appears locally, complete it in the Chrome window and extraction will continue using the persisted browser session. Headed mode checks one athlete at a time so only one security prompt can appear. The wait defaults to 10 minutes and can be adjusted with `PARKRUN_CAPTCHA_TIMEOUT_MS`.

In a container, headless mode stops with a clear error if an interactive CAPTCHA is required. An optional password-protected browser console can instead run Chrome in headed mode on a virtual display. When a CAPTCHA appears, the report screen shows a link to that console so it can be completed manually. The first run can take a few minutes, and the interface displays live progress throughout. Athlete histories are cached locally for 12 hours, making repeat checks faster.

Suggested highlights are inferred only from the available results and are never silently added. Each can be included or dismissed before copying the post. Weekly volunteer statistics are not yet extracted because they require collecting each event's separate volunteer roster.

During development, `src/setupProxy.js` attaches the live API to the React development server. In production, `server.js` serves both the built interface and the API from the same port.

## Deploy to Coolify

The repository includes both a `Dockerfile` and `compose.yaml`. The container defaults to headless Chromium. It also includes an optional noVNC browser console for manually completing a CAPTCHA in hosted environments.

Recommended Coolify setup:

1. Create a new resource from this Git repository.
2. Select **Docker Compose** as the build pack. Coolify will read `compose.yaml`.
3. Assign the application domain to the `nbrg-parkrun-report` service on port `3000`.
4. Deploy. The named `nbrg-parkrun-data` volume preserves the browser session and athlete-history cache.
5. Set the health-check path to `/health` if Coolify does not pick up the image health check automatically.

For a Dockerfile deployment instead, select **Dockerfile**, expose port `3000`, and add persistent storage mounted at `/data` in Coolify. No environment variables are required for headless mode because the production defaults are included in the image.

### Hosted CAPTCHA browser

To allow manual CAPTCHA completion in Coolify:

1. Keep the application domain connected to port `3000`.
2. Add a second HTTPS domain to the same service, connected to port `6080` (for example, `nbrg-browser.example.com`).
3. Set `PARKRUN_HEADLESS=false`.
4. Set `PARKRUN_VNC_PASSWORD` to a unique random password stored as a Coolify secret. Traditional VNC authentication uses only its first eight characters, so make those eight characters random.
5. Set `PARKRUN_BROWSER_URL` to the second domain, for example `https://nbrg-browser.example.com/vnc.html?autoconnect=true&resize=scale`.
6. Redeploy. The logs should contain `browser_console_ready` and `server_listening`.

When the report encounters a CAPTCHA, its loading panel changes to **Security check needs you** and shows **Open secure browser**. Open it, enter the VNC password, complete the CAPTCHA, and return to the report tab. Do not expose port `6080` without HTTPS and a random VNC password because the console can display the persistent browser session. Restrict the browser domain by IP or an additional access-control layer when your hosting setup supports it.

### Coolify logs

The Node server and scraper write single-line JSON logs to stdout/stderr for Coolify. Useful events include `server_listening`, `report_requested`, `browser_launch`, `page_load_response`, `waiting_for_captcha`, `captcha_completed`, `checking_athletes`, `report_completed`, and `report_failed`. WAF response actions and HTTP statuses are logged, but WAF tokens and browser cookies are not.

The server intentionally permits only one live report extraction at a time. A second request receives a friendly “report already being checked” response instead of opening another 90 browser checks.

Production extraction is deliberately limited to one athlete page at a time with a short delay between pages. This makes the first uncached report slower, but reduces container resource spikes and the chance of triggering parkrun's automated-access protection. `PARKRUN_WORKERS` and `PARKRUN_REQUEST_DELAY_MS` can be adjusted if necessary.

This project is not affiliated with parkrun.
