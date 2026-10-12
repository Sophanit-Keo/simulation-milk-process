import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * The app must not contact any origin but its own: fonts and everything else ship in the bundle.
 * Every test blocks such requests, so no result depends on outside network access, and lists their
 * URLs in `thirdPartyRequests` for the tests that check there were none.
 */
export const test = base.extend<{ thirdPartyRequests: string[] }>({
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
    },
    { auto: true },
  ],
});
