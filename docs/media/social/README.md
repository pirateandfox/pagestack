# Social preview

`../social-preview.png` is the GitHub social card (1280×640). It is set by hand under the repo's
Settings → General → Social preview.

To change it, edit `card.html`, open it at a 1280×640 viewport and screenshot the page, e.g. with
Playwright:

```js
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.goto(`file://${process.cwd()}/docs/media/social/card.html`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'docs/media/social-preview.png' });
```

`editor-frame.png` is the last frame of the bakery demo recording (`examples/bakery`).
