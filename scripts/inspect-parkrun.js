const path = require('path');
const puppeteer = require('puppeteer-core');

const url = process.argv[2] || 'https://www.parkrun.com/results/consolidatedclub/?clubNum=22631&eventdate=2026-07-11';

(async () => {
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS === 'true',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: path.join(process.cwd(), '.parkrun-browser-profile'),
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const [page] = await browser.pages();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, { timeout: 120000 });
  const summary = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((node) => node.textContent.trim()).filter(Boolean),
    tables: Array.from(document.querySelectorAll('table')).slice(0, 5).map((table) => ({
      id: table.id,
      className: table.className,
      headers: Array.from(table.querySelectorAll('th')).map((cell) => cell.textContent.trim()),
      rows: table.querySelectorAll('tbody tr').length,
      sampleRows: Array.from(table.querySelectorAll('tbody tr')).filter((row) => row.querySelector('td')).slice(0, 3).map((row) =>
        Array.from(row.querySelectorAll('td')).map((cell) => ({
          text: cell.textContent.trim().replace(/\s+/g, ' '),
          className: cell.className,
          dataLabel: cell.getAttribute('data-label'),
          links: Array.from(cell.querySelectorAll('a')).map((link) => ({ text: link.textContent.trim(), href: link.href })),
        }))
      ),
    })),
  }));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await browser.close();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
