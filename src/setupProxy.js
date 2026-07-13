const { analyseReport } = require('../scripts/parkrun-service');

module.exports = function setupProxy(app) {
  app.get('/api/parkrun-report', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const report = await analyseReport(String(request.query.date || ''));
      response.json(report);
    } catch (error) {
      response.status(502).json({ error: error.message || 'Unable to analyse parkrun report' });
    }
  });
};
