const path = require('path');
const express = require('express');
const { analyseReport, closeBrowser } = require('./scripts/parkrun-service');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
let activeReport = null;

app.disable('x-powered-by');

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/parkrun-report', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const date = String(request.query.date || '');

  if (activeReport) {
    response.status(429).json({ error: 'A report is already being checked. Please wait for it to finish.' });
    return;
  }

  try {
    activeReport = analyseReport(date);
    response.json(await activeReport);
  } catch (error) {
    console.error(`[parkrun-report] ${date}:`, error);
    response.status(502).json({ error: error.message || 'Unable to analyse parkrun report' });
  } finally {
    activeReport = null;
  }
});

const buildDirectory = path.join(__dirname, 'build');
app.use(express.static(buildDirectory, { maxAge: '1h' }));
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(buildDirectory, 'index.html'));
});

const server = app.listen(port, host, () => {
  console.log(`NBRG report app listening on http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await closeBrowser();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
