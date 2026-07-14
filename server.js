const path = require('path');
const express = require('express');
const { analyseReport, closeBrowser } = require('./scripts/parkrun-service');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
let activeReport = null;
let reportStatus = { phase: 'idle', message: 'No report is currently running.' };

function log(level, event, details = {}) {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, component: 'server', event, ...details });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(entry);
}

app.disable('x-powered-by');

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/parkrun-report/status', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ active: Boolean(activeReport), ...reportStatus });
});

app.get('/api/parkrun-report', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const date = String(request.query.date || '');

  if (activeReport) {
    log('warn', 'report_rejected_busy', { date });
    response.status(429).json({ error: 'A report is already being checked. Please wait for it to finish.' });
    return;
  }

  const startedAt = Date.now();
  log('info', 'report_requested', { date, ip: request.ip });
  try {
    reportStatus = { phase: 'starting', message: 'Starting the parkrun report.' };
    activeReport = analyseReport(date, {
      onProgress(update) {
        reportStatus = update;
      },
    });
    response.json(await activeReport);
  } catch (error) {
    reportStatus = { phase: 'failed', message: error.message || 'Unable to analyse parkrun report' };
    log('error', 'report_failed', { date, durationMs: Date.now() - startedAt, message: error.message, stack: error.stack });
    response.status(502).json({ error: error.message || 'Unable to analyse parkrun report' });
  } finally {
    log('info', 'report_request_finished', { date, durationMs: Date.now() - startedAt, phase: reportStatus.phase });
    activeReport = null;
  }
});

const buildDirectory = path.join(__dirname, 'build');
app.use(express.static(buildDirectory, { maxAge: '1h' }));
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(buildDirectory, 'index.html'));
});

const server = app.listen(port, host, () => {
  log('info', 'server_listening', {
    url: `http://${host}:${port}`,
    nodeEnv: process.env.NODE_ENV || 'development',
    headless: process.env.PARKRUN_HEADLESS === 'true',
    browserUrlConfigured: Boolean(process.env.PARKRUN_BROWSER_URL),
  });
});

async function shutdown(signal) {
  log('info', 'shutdown_started', { signal });
  server.close(async () => {
    await closeBrowser();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => log('error', 'unhandled_rejection', { message: error?.message || String(error), stack: error?.stack }));
process.on('uncaughtException', (error) => {
  log('error', 'uncaught_exception', { message: error.message, stack: error.stack });
  process.exit(1);
});
