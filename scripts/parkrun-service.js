const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CLUB_NUMBER = '22631';
const CLUB_NAME = 'North Bristol Running Group';
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DATA_DIR = process.env.PARKRUN_DATA_DIR || process.cwd();
const PROFILE_DIR = process.env.PARKRUN_PROFILE_DIR || path.join(DATA_DIR, '.parkrun-browser-profile');
const CACHE_DIR = path.join(DATA_DIR, '.cache', 'parkrun-athletes');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const HEADLESS = process.env.PARKRUN_HEADLESS === 'true';
const DEFAULT_WORKER_COUNT = process.env.NODE_ENV === 'production' || !HEADLESS ? 1 : 3;
const WORKER_COUNT = Math.max(1, Number(process.env.PARKRUN_WORKERS || DEFAULT_WORKER_COUNT));
const REQUEST_DELAY_MS = Math.max(250, Number(process.env.PARKRUN_REQUEST_DELAY_MS || (process.env.NODE_ENV === 'production' ? 1250 : 250)));
const INTERACTIVE_CAPTCHA_TIMEOUT_MS = Math.max(60000, Number(process.env.PARKRUN_CAPTCHA_TIMEOUT_MS || 10 * 60 * 1000));

let browserPromise;

function log(level, event, details = {}) {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, component: 'parkrun', event, ...details });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(entry);
}

function progress(onProgress, phase, message, details = {}) {
  const update = { phase, message, ...details };
  log('info', phase, details);
  onProgress?.(update);
}

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
    log('info', 'browser_launch', { headless: HEADLESS, executablePath: CHROME_PATH, display: process.env.DISPLAY || null });
    browserPromise = puppeteer.launch({
      headless: HEADLESS,
      executablePath: CHROME_PATH,
      userDataDir: PROFILE_DIR,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', ...containerArgs],
      defaultViewport: { width: 1180, height: 800 },
    }).then((browser) => {
      log('info', 'browser_ready', { headless: HEADLESS });
      return browser;
    }).catch((error) => {
      log('error', 'browser_launch_failed', { message: error.message });
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

async function inspectPage(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      hasResults: Array.from(document.querySelectorAll('table')).some((table) => table.querySelectorAll('td').length > 0),
      hasSecurityCheck: Boolean(document.querySelector('#captcha-container, .amzn-captcha-modal, #amzn-btn-verify-internal'))
        || /captcha|verify you are human|security check/i.test(text),
    };
  }).catch(() => ({ hasResults: false, hasSecurityCheck: true }));
}

async function waitForPageOutcome(page, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let securityDetectedAt = 0;

  while (Date.now() < deadline) {
    const state = await inspectPage(page);
    if (state.hasResults && !state.hasSecurityCheck) return state;
    if (state.hasSecurityCheck) {
      securityDetectedAt ||= Date.now();
      if (Date.now() - securityDetectedAt >= 3000) return state;
    } else {
      securityDetectedAt = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out after ${timeout}ms while waiting for parkrun results.`);
}

async function waitForInteractiveCaptcha(page, onProgress) {
  progress(onProgress, 'waiting_for_captcha', 'Complete the parkrun security check in the secure browser.', {
    browserUrl: process.env.PARKRUN_BROWSER_URL || null,
  });
  await page.bringToFront();
  const deadline = Date.now() + INTERACTIVE_CAPTCHA_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const state = await inspectPage(page);
    if (state.hasResults && !state.hasSecurityCheck) {
      progress(onProgress, 'captcha_completed', 'Security check completed. Continuing the report.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const error = new Error('The parkrun security check was not completed in time. Please generate the report again.');
  error.code = 'PARKRUN_SECURITY_CHALLENGE';
  throw error;
}

function securityChallengeError(onProgress) {
  progress(onProgress, 'captcha_blocked', 'parkrun requested an interactive CAPTCHA, but the browser is running headlessly.');
  const error = new Error('parkrun requested a CAPTCHA, so the report could not be checked automatically. Please try again later.');
  error.code = 'PARKRUN_SECURITY_CHALLENGE';
  return error;
}

async function loadPage(page, url, onProgress, pageType) {
  log('info', 'page_load_start', { pageType, host: new URL(url).host });
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const wafAction = response?.headers()?.['x-amzn-waf-action'];
  log(wafAction ? 'warn' : 'info', 'page_load_response', {
    pageType,
    host: new URL(url).host,
    status: response?.status() || null,
    wafAction: wafAction || null,
  });
  if (wafAction === 'captcha') {
    if (HEADLESS) throw securityChallengeError(onProgress);
    await waitForInteractiveCaptcha(page, onProgress);
    return;
  }
  try {
    const state = await waitForPageOutcome(page);
    if (state.hasSecurityCheck) {
      if (HEADLESS) throw securityChallengeError(onProgress);
      await waitForInteractiveCaptcha(page, onProgress);
    }
  } catch (error) {
    if (error.code === 'PARKRUN_SECURITY_CHALLENGE') throw error;
    const state = await inspectPage(page);
    if (wafAction === 'challenge' || state.hasSecurityCheck) {
      if (HEADLESS) throw securityChallengeError(onProgress);
      await waitForInteractiveCaptcha(page, onProgress);
      return;
    }
    throw error;
  }
}

async function extractClubResults(page, date, onProgress) {
  const url = `https://www.parkrun.com/results/consolidatedclub/?clubNum=${CLUB_NUMBER}&eventdate=${date}`;
  await loadPage(page, url, onProgress, 'club_report');
  return page.evaluate(({ clubName }) => {
    const cleanEvent = (value) => value.replace(/\s+parkrun$/i, '').trim();
    const findEventResultsUrl = (table, heading) => {
      const candidates = [];
      const addLinks = (element) => {
        if (!element) return;
        if (element.matches?.('a[href]')) candidates.push(element);
        candidates.push(...element.querySelectorAll?.('a[href]') || []);
      };

      addLinks(table);
      addLinks(heading);
      let sibling = table.previousElementSibling;
      for (let checked = 0; sibling && checked < 6; checked += 1, sibling = sibling.previousElementSibling) {
        addLinks(sibling);
        if (sibling.tagName === 'TABLE') break;
      }

      return candidates.map((link) => link.href).find((href) => {
        const pathname = new URL(href).pathname;
        return /\/results\/(?:weeklyresults|latestresults|\d+)\/?$/i.test(pathname)
          && !/consolidatedclub/i.test(pathname);
      }) || null;
    };
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
      const eventResultsUrl = findEventResultsUrl(table, heading || fallbackHeading);

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
          eventResultsUrl,
          time,
          position: Number((cells[positionIndex]?.textContent || '').match(/\d+/)?.[0] || 0),
        });
      });
    });
    return results;
  }, { clubName: CLUB_NAME });
}

async function addAgeGroupPositions(page, clubResults, onProgress) {
  const eventGroups = new Map();
  clubResults.forEach((result) => {
    if (!result.eventResultsUrl) return;
    const group = eventGroups.get(result.eventResultsUrl) || [];
    group.push(result);
    eventGroups.set(result.eventResultsUrl, group);
  });

  const failures = [];
  let completed = 0;
  progress(onProgress, 'checking_age_groups', `Checking age-group positions at ${eventGroups.size} events.`, {
    completed,
    total: eventGroups.size,
  });

  for (const [url, eventResults] of eventGroups) {
    try {
      await loadPage(page, url, onProgress, 'event_results');
      const positions = await page.evaluate((targetAthleteIds) => {
        const targetIds = new Set(targetAthleteIds);
        const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
          const headers = Array.from(candidate.querySelectorAll('th')).map((cell) => cell.textContent.trim().toLowerCase());
          return headers.some((header) => header === 'pos' || header.includes('position'))
            && headers.some((header) => header.includes('parkrunner'))
            && headers.some((header) => header.includes('age cat') || header.includes('age group'));
        });
        if (!table) throw new Error('The event results table did not include age categories.');

        const headers = Array.from(table.querySelectorAll('th')).map((cell) => cell.textContent.trim().toLowerCase());
        const positionIndex = headers.findIndex((header) => header === 'pos' || header.includes('position'));
        const runnerIndex = headers.findIndex((header) => header.includes('parkrunner'));
        const categoryIndex = headers.findIndex((header) => header.includes('age cat') || header.includes('age group'));
        const categoryCounts = new Map();
        const matches = {};

        const participants = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const categoryText = `${cells[categoryIndex]?.textContent || ''} ${row.textContent || ''}`;
          const ageCategory = categoryText.match(/\b(?:[JSV][MW]\d{2,3}(?:-\d{2,3})?|[MW]WC)\b/i)?.[0]?.toUpperCase() || '';
          const runnerLink = cells[runnerIndex]?.querySelector('a[href*="/parkrunner/"]')
            || row.querySelector('a[href*="/parkrunner/"]');
          return {
            position: Number((cells[positionIndex]?.textContent || '').match(/\d+/)?.[0] || 0),
            ageCategory,
            athleteId: runnerLink?.href.match(/\/parkrunner\/(\d+)/)?.[1] || null,
          };
        }).filter((participant) => participant.position > 0 && participant.ageCategory)
          .sort((a, b) => a.position - b.position);

        participants.forEach(({ ageCategory, athleteId }) => {
          const ageGroupPosition = (categoryCounts.get(ageCategory) || 0) + 1;
          categoryCounts.set(ageCategory, ageGroupPosition);
          if (athleteId && targetIds.has(athleteId)) {
            matches[athleteId] = { ageCategory, ageGroupPosition };
          }
        });

        return matches;
      }, eventResults.map((result) => result.athleteId));

      eventResults.forEach((result) => Object.assign(result, positions[result.athleteId] || {}));
    } catch (error) {
      if (error.code === 'PARKRUN_SECURITY_CHALLENGE') throw error;
      failures.push({
        event: eventResults[0]?.event || 'Unknown event',
        message: error.message,
      });
      log('warn', 'age_group_check_failed', {
        event: eventResults[0]?.event || 'Unknown event',
        message: error.message,
      });
    } finally {
      completed += 1;
      progress(onProgress, 'checking_age_groups', `Checked age-group positions at ${completed} of ${eventGroups.size} events.`, {
        completed,
        total: eventGroups.size,
        failures: failures.length,
      });
    }
    if (completed < eventGroups.size) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  const missingLinks = new Set(clubResults.filter((result) => !result.eventResultsUrl).map((result) => result.event));
  missingLinks.forEach((event) => failures.push({ event, message: 'No event results link was found.' }));
  return failures;
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

async function extractAthleteHistory(page, athleteId, onProgress) {
  const cached = readCache(athleteId);
  if (cached) {
    log('info', 'athlete_cache_hit', { athleteId });
    return cached;
  }
  await loadPage(page, `https://www.parkrun.org.uk/parkrunner/${athleteId}/all/`, onProgress, 'athlete_history');
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
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      }
    } finally {
      await page.close();
    }
  });
  await Promise.all(workers);
  return results;
}

async function analyseReport(date, options = {}) {
  const onProgress = options.onProgress;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must use YYYY-MM-DD format');
  const startedAt = Date.now();
  progress(onProgress, 'starting', 'Starting the parkrun report.', { date, headless: HEADLESS });
  const browser = await getBrowser();
  const reportPage = await browser.newPage();
  let clubResults;
  let ageGroupFailures = [];
  try {
    progress(onProgress, 'checking_club_report', 'Checking the NBRG club report.', { date });
    clubResults = await extractClubResults(reportPage, date, onProgress);
    if (clubResults.length) {
      ageGroupFailures = await addAgeGroupPositions(reportPage, clubResults, onProgress);
    }
  } finally {
    await reportPage.close();
  }
  if (!clubResults.length) throw new Error(`No NBRG results were found for ${date}`);
  progress(onProgress, 'checking_athletes', `Checking ${clubResults.length} athlete histories.`, {
    completed: 0,
    total: clubResults.length,
  });

  const failures = [];
  let completed = 0;
  const analysed = await mapWithWorkers(clubResults, async (result, page) => {
    let securityChallenge = false;
    try {
      const history = await extractAthleteHistory(page, result.athleteId, onProgress);
      return analyseAthlete(result, history, date);
    } catch (error) {
      if (error.code === 'PARKRUN_SECURITY_CHALLENGE') {
        securityChallenge = true;
        throw error;
      }
      failures.push({ athleteId: result.athleteId, name: result.name, message: error.message });
      return { ...result, totalRuns: 0, eventRuns: 0, verified: false };
    } finally {
      if (!securityChallenge) {
        completed += 1;
        if (completed === clubResults.length || completed % 10 === 0) {
          progress(onProgress, 'checking_athletes', `Checked ${completed} of ${clubResults.length} athlete histories.`, {
            completed,
            total: clubResults.length,
            failures: failures.length,
          });
        }
      }
    }
  });

  const report = {
    clubNumber: Number(CLUB_NUMBER),
    clubName: CLUB_NAME,
    date,
    memberCount: analysed.length,
    eventCount: new Set(analysed.map((result) => normaliseEvent(result.event))).size,
    results: analysed,
    profileFailures: failures,
    ageGroupFailures,
    generatedAt: new Date().toISOString(),
  };
  const completion = {
    date,
    members: report.memberCount,
    events: report.eventCount,
    failures: failures.length,
    ageGroupFailures: ageGroupFailures.length,
    durationMs: Date.now() - startedAt,
  };
  log('info', 'report_completed', completion);
  onProgress?.({ phase: 'complete', message: 'Report completed.', ...completion });
  return report;
}

module.exports = { analyseReport, closeBrowser };
