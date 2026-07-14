const { analyseReport } = require('../scripts/parkrun-service');

module.exports = function setupProxy(app) {
  let active = false;
  let status = { phase: 'idle', message: 'No report is currently running.' };

  app.get('/api/parkrun-report/status', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ active, ...status });
  });

  app.get('/api/parkrun-report', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    active = true;
    status = { phase: 'starting', message: 'Starting the parkrun report.' };
    try {
      const report = await analyseReport(String(request.query.date || ''), { onProgress: (update) => { status = update; } });
      response.json(report);
    } catch (error) {
      status = { phase: 'failed', message: error.message || 'Unable to analyse parkrun report' };
      response.status(502).json({ error: error.message || 'Unable to analyse parkrun report' });
    } finally {
      active = false;
    }
  });
};
