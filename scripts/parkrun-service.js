const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CLUB_NUMBER = '22631';
const CLUB_NAME = 'North Bristol Running Group';
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DATA_DIR = process.env.PARKRUN_DATA_DIR || process.cwd();
const PROFILE_DIR = path.join(DATA_DIR, '.parkrun-browser-profile');
const CACHE_DIR = path.join(DATA_DIR, '.cache', 'parkrun-athletes');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WORKER_COUNT = 3;

let browserPromise;

function cleanEvent(value) {
  return value.replace(/\s+parkrun$/i, '').trim();
}

function normaliseEvent(value) {
  return cleanEvent(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normaliseTime(value) {
  const parts = value.trim().split(':').map(Number);
  const totalSeconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function seconds(value) {
  const parts = value.split(':').map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function ukDateToIso(value) {
  const [day, month, year] = value.split('/');
  return `${year}-${month}-${day}`;
}

async function getBrowser() {
  if (!browserPromise) {
    const containerArgs = process.env.PUPPETEER_NO_SANDBOX === 'true'
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : [];
    browserPromise = puppeteer.launch({
      headless: process.env.PARKRUN_HEADLESS === 'true',
      executablePath: CHROME_PATH,
      userDataDir: PROFILE_DIR,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', ...containerArgs],
      defaultViewport: { width: 1180, height: 800 },
    }).catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // The browser may already have stopped during container shutdown.
  } finally {
    browserPromise = undefined;
  }
}

async function waitForResults(page, timeout = 120000) {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('table')).some((table) => table.querySelectorAll('td').length > 0),
    { timeout }
  );
}

async function loadPage(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const wafAction = response?.headers()?.['x-amzn-waf-action'];
  if (wafAction === 'captcha') {
    throw new Error('parkrun requested a CAPTCHA, so the report could not be checked automatically. Please try again later.');
  }
  try {
    await waitForResults(page);
  } catch (error) {
    const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (wafAction === 'challenge' || /captcha|verify you are human|security check/i.test(pageText)) {
      throw new Error('parkrun blocked the automated check with a security challenge. Please try again later.');
    }
    throw error;
  }
}

async function extractClubResults(page, date) {
  const url = `https://www.parkrun.com/results/consolidatedclub/?clubNum=${CLUB_NUMBER}&eventdate=${date}`;
  await loadPage(page, url);
  return page.evaluate(({ clubName }) => {
    const cleanEvent = (value) => value.replace(/\s+parkrun$/i, '').trim();
    const results = [];
    document.querySelectorAll('table.sortable').forEach((table) => {
      const headers = Array.from(table.querySelectorAll('th')).map((cell) => cell.textContent.trim().toLowerCase());
      const positionIndex = headers.findIndex((header) => header.includes('position') && !header.includes('gender'));
      const runnerIndex = headers.findIndex((header) => header.includes('parkrunner'));
      const clubIndex = headers.findIndex((header) => header === 'club');
      const timeIndex = headers.findIndex((header) => header === 'time');
      if (runnerIndex < 0 || timeIndex < 0) return;

      let heading = table.previousElementSibling;
      while (heading && !/^H[1-4]$/.test(heading.tagName)) heading = heading.previousElementSibling;
      const fallbackHeading = table.parentElement?.querySelector('h2,h3,h4');
      const event = cleanEvent((heading || fallbackHeading)?.textContent || 'Unknown event');

      table.querySelectorAll('tbody tr').forEach((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (!cells.length) return;
        const club = (cells[clubIndex]?.textContent || '').trim();
        if (club !== clubName) return;
        const runnerLink = cells[runnerIndex]?.querySelector('a[href*="/parkrunner/"]');
        const id = runnerLink?.href.match(/\/parkrunner\/(\d+)/)?.[1];
        const name = runnerLink?.textContent.trim().replace(/\s+/g, ' ');
        const rawTime = (cells[timeIndex]?.textContent || '').trim();
        const timeMatch = rawTime.match(/(?:\d{2}:)?\d{1,2}:\d{2}/);
        if (!id || !name || !timeMatch) return;
        const timeParts = timeMatch[0].split(':').map(Number);
        const totalSeconds = timeParts.length === 3
          ? timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
          : timeParts[0] * 60 + timeParts[1];
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const time = hours
          ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
          : `${minutes}:${String(seconds).padStart(2, '0')}`;
        results.push({
          athleteId: id,
          name,
          event,
          time,
          position: Number((cells[positionIndex]?.textContent || '').match(/\d+/)?.[0] || 0),
        });
      });
    });
    return results;
  }, { clubName: CLUB_NAME });
}

function readCache(athleteId) {
  const file = path.join(CACHE_DIR, `${athleteId}.json`);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(athleteId, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${athleteId}.json`), JSON.stringify(data));
}

async function extractAthleteHistory(page, athleteId) {
  const cached = readCache(athleteId);
  if (cached) return cached;
  await loadPage(page, `https://www.parkrun.org.uk/parkrunner/${athleteId}/all/`);
  const data = await page.evaluate(() => {
    const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
      const headers = Array.from(candidate.querySelectorAll('th')).map((cell) => cell.textContent.trim().toLowerCase());
      return headers.includes('event') && headers.includes('run date') && headers.includes('pb?');
    });
    if (!table) return { runs: [] };
    const runs = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 5) return null;
      return {
        event: cells[0].textContent.trim().replace(/\s+parkrun$/i, ''),
        date: cells[1].textContent.trim(),
        time: cells[4].textContent.trim(),
      };
    }).filter(Boolean);
    return { runs };
  });
  writeCache(athleteId, data);
  return data;
}

function analyseAthlete(result, history, date) {
  const eventKey = normaliseEvent(result.event);
  const reportSeconds = seconds(result.time);
  const throughDate = history.runs
    .map((run) => ({ ...run, isoDate: ukDateToIso(run.date), seconds: seconds(normaliseTime(run.time)) }))
    .filter((run) => run.isoDate <= date);
  const atEvent = throughDate.filter((run) => normaliseEvent(run.event) === eventKey);
  const priorRuns = throughDate.filter((run) => run.isoDate < date);
  const priorAtEvent = atEvent.filter((run) => run.isoDate < date);
  const priorAllBest = priorRuns.length ? Math.min(...priorRuns.map((run) => run.seconds)) : Infinity;
  const priorEventBest = priorAtEvent.length ? Math.min(...priorAtEvent.map((run) => run.seconds)) : Infinity;
  const hasSelectedRun = throughDate.some((run) => run.isoDate === date && normaliseEvent(run.event) === eventKey && run.seconds === reportSeconds);

  return {
    ...result,
    totalRuns: throughDate.length,
    eventRuns: atEvent.length,
    firstTimer: atEvent.length === 1,
    coursePb: hasSelectedRun && priorAtEvent.length > 0 && reportSeconds < priorEventBest,
    allTimePb: hasSelectedRun && priorRuns.length > 0 && reportSeconds < priorAllBest,
    verified: hasSelectedRun,
  };
}

async function mapWithWorkers(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const browser = await getBrowser();
  const workers = Array.from({ length: Math.min(WORKER_COUNT, items.length) }, async () => {
    const page = await browser.newPage();
    try {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index], page, index);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      await page.close();
    }
  });
  await Promise.all(workers);
  return results;
}

async function analyseReport(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must use YYYY-MM-DD format');
  const browser = await getBrowser();
  const reportPage = await browser.newPage();
  let clubResults;
  try {
    clubResults = await extractClubResults(reportPage, date);
  } finally {
    await reportPage.close();
  }
  if (!clubResults.length) throw new Error(`No NBRG results were found for ${date}`);

  const failures = [];
  const analysed = await mapWithWorkers(clubResults, async (result, page) => {
    try {
      const history = await extractAthleteHistory(page, result.athleteId);
      return analyseAthlete(result, history, date);
    } catch (error) {
      failures.push({ athleteId: result.athleteId, name: result.name, message: error.message });
      return { ...result, totalRuns: 0, eventRuns: 0, verified: false };
    }
  });

  return {
    clubNumber: Number(CLUB_NUMBER),
    clubName: CLUB_NAME,
    date,
    memberCount: analysed.length,
    eventCount: new Set(analysed.map((result) => normaliseEvent(result.event))).size,
    results: analysed,
    profileFailures: failures,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { analyseReport, closeBrowser };
