import { test as base, expect } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Warnings the browser logs about its own work, which the app can neither cause nor avoid. Headless
 * Chromium on software GL (SwiftShader) composites the page in software, so it reads every WebGL frame
 * back and its GPU process reports the stall, four times per page. A bare WebGL canvas that only clears
 * itself logs the same; the app never calls readPixels. Matched narrowly, so any other GL message fails.
 */
export const BROWSER_GL_NOTES: readonly RegExp[] = [
  /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, [A-Z_]+, High\): GPU stall due to ReadPixels( \(this message will no longer repeat\))?$/,
];

/**
 * True for a file request answered with an HTML page. Vite's dev server and `vite preview` answer a
 * missing file with index.html and status 200 (the single-page fallback), so a missing model or texture
 * never shows as a 404 there; and the scene keeps a grey box when a model fails to load, without a word
 * in the console. A request for a path with a file extension other than .html that gets HTML back is
 * that fallback.
 */
function isPageFallback(navigation: boolean, url: string, contentType: string | undefined): boolean {
  if (navigation || !contentType?.startsWith('text/html')) return false;
  const extension = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  return extension !== undefined && extension !== 'html' && extension !== 'htm';
}

interface Guards {
  /** URLs of the requests to another origin so far; each was blocked. */
  thirdPartyRequests: string[];
  /** Console errors and warnings, uncaught page errors, failed requests, 4xx/5xx responses and missing files so far. */
  pageProblems: string[];
}

/**
 * Two automatic fixtures guard every browser test.
 *
 * - The app must not contact any origin but its own: fonts and everything else ship in the bundle.
 *   Such requests are blocked, so no result depends on outside network access, and their URLs are
 *   listed in `thirdPartyRequests`.
 * - The page must stay clean: a console error or warning, an uncaught exception, a request that fails
 *   (a blocked one included), a response with a 4xx or 5xx status, or a file answered with the HTML
 *   page (the server's 404 in disguise) fails the test. Every model, texture and font is committed, so
 *   nothing may be missing. They are listed in `pageProblems` as they happen and checked once the test
 *   body is done, so a test that checks them itself (after letting the frame loop run, say) fails
 *   first, with its own message.
 */
export const test = base.extend<Guards>({
  thirdPartyRequests: [
    async ({ page, baseURL }, use) => {
      if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL');
      const appOrigin = new URL(baseURL).origin;
      const urls: string[] = [];
      await page.route(
        (url) => (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== appOrigin,
        (route) => {
          urls.push(route.request().url());
          return route.abort('blockedbyclient');
        },
      );
      await use(urls);
      expect(urls, 'requests to another origin').toEqual([]);
    },
    { auto: true },
  ],
  pageProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        const type = message.type();
        if (type !== 'error' && type !== 'warning') return;
        if (type === 'warning' && BROWSER_GL_NOTES.some((note) => note.test(message.text()))) return;
        // The text of a failed load names no URL; the location does.
        const { url, lineNumber } = message.location();
        problems.push(`console.${type}: ${message.text()}${url ? ` (${url}:${lineNumber})` : ''}`);
      });
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
      page.on('requestfailed', (request) =>
        problems.push(`request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'no reason given'})`),
      );
      page.on('response', (response) => {
        const request = response.request();
        if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${request.method()} ${response.url()}`);
        else if (isPageFallback(request.isNavigationRequest(), response.url(), response.headers()['content-type'])) {
          problems.push(`missing file: ${request.method()} ${response.url()} was answered with the HTML page`);
        }
      });
      await use(problems);
      expect(problems, 'console errors and warnings, page errors, failed requests').toEqual([]);
    },
    { auto: true },
  ],
});
