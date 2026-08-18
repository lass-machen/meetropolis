import { test, expect, type Page } from '@playwright/test';

// Layout guard for the public auth screen (AuthLayout.tsx). The unit suite
// cannot cover any of this: Vitest runs under jsdom, which does no layout, so
// every getBoundingClientRect there is zero. Without this spec the whole
// responsive contract of that file - two columns that give way in the right
// order, a form column that never drops below its content, hyphenation instead
// of words cut in half - can be deleted without a single gate turning red.
//
// Runs against a dev server (WEB_BASE_URL, default http://localhost:5173) and
// only with E2E_RUN=true, like the other specs in this folder.
const SHOULD_RUN = process.env.E2E_RUN === 'true';
const it = SHOULD_RUN ? test : test.skip;

const WIDTHS = [320, 375, 768, 769, 820, 1024, 1025, 1051, 1100, 1280] as const;

const LONG_MAIL = 'ausgesprochen.langer.vorname.nachname+rechnungsstelle@sehr-lange-firmendomain-beispiel-gmbh.example';

const PLAN = (tierKey: string, amount: number, limit: number, min: number, sortOrder: number) => ({
  tierKey,
  name: { de: tierKey, en: tierKey },
  priceAmount: amount,
  priceCurrency: 'EUR',
  priceInterval: 'month',
  concurrentLimit: limit,
  minConnections: min,
  features: [{ de: 'Feature', en: 'Feature' }],
  sortOrder,
});
const PLANS = {
  plans: [PLAN('starter', 1900, 10, 1, 1), PLAN('team', 4900, 25, 11, 2), PLAN('business', 9900, 50, 26, 3)],
};

type View = 'login' | 'register1' | 'register2' | 'register3' | 'register4' | 'invite' | 'forgot' | 'reset93' | 'guest';

interface Case {
  view: View;
  billing: boolean;
  lang: 'de' | 'en';
}

/**
 * The audit. Four hard criteria plus one that needs explaining: a run of
 * letters rendering on two lines is only a defect when the break had nowhere
 * legal to land.
 *
 * A run of letters can only be split by two mechanisms - `hyphens: auto`,
 * which is legal and intended, or one of the emergency breaks
 * (`overflow-wrap: anywhere|break-word`, `word-break: break-all`), which cuts
 * between arbitrary letters. The run itself carries no hyphen and no soft
 * hyphen, because the pattern below matches letters only. So instead of
 * modelling which of the two happened from widths, the audit asks the engine:
 * it neutralises the emergency breaks on the parent, counts the line boxes of
 * the very same range again and puts the style back. Fewer lines without the
 * emergency breaks means the browser had to cut the word to make it fit.
 *
 * Measuring widths instead does not work, and not only in the margins: on a
 * button that has shrunk to its `anywhere` minimum (a single character) the
 * German label "Weiter" falls apart into three to five lines depending on the
 * engine, while the box is still wider than the hyphenated fragment needs -
 * 41px of content against 34.3px in Chromium - so every width comparison,
 * with or without padding, calls that break legal.
 *
 * Machine strings (a long e-mail address, a URL) are exempt: taking those
 * apart anywhere is exactly what `overflow-wrap: anywhere` is there for. The
 * test looks at the whole whitespace-delimited token around the match and
 * asks whether one of @._+/: sits between two alphanumerics inside it, so
 * "firmendomain" in an address is exempt while a sentence-final "Willkommen."
 * or a label ending in ":" is not.
 */
function auditLayout() {
  const root = document.querySelector('.pub-auth-layout');
  const problems: string[] = [];
  if (!root) return problems;
  const clientW = document.documentElement.clientWidth;
  const label = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0]}`;
  const visible = (el: Element) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };

  if (document.documentElement.scrollWidth - clientW > 1) {
    problems.push(`document overflows by ${document.documentElement.scrollWidth - clientW}px`);
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > clientW + 0.5 || r.left < -0.5)
      problems.push(`${label(el)} leaves the viewport (${r.left.toFixed(0)}..${r.right.toFixed(0)})`);
    const tag = el.tagName.toLowerCase();
    const scrolls = !['input', 'textarea', 'select', 'svg'].includes(tag);
    if (scrolls && el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 1) {
      problems.push(`${label(el)} overflows its own box (${el.clientWidth} < ${el.scrollWidth})`);
    }
  }

  const lineCount = (range: Range) => new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  // The token around the match, i.e. the surrounding run of non-whitespace.
  const tokenAround = (text: string, start: number, end: number) => {
    let from = start;
    let to = end;
    while (from > 0 && !/\s/.test(text[from - 1])) from--;
    while (to < text.length && !/\s/.test(text[to])) to++;
    return text.slice(from, to);
  };
  const machine = /[\p{L}\p{N}][@._+/:][\p{L}\p{N}]/u;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const words = /\p{L}{2,}/gu;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = node.nodeValue ?? '';
    if (!parent || !visible(parent) || !text.trim()) continue;
    words.lastIndex = 0;
    for (let m = words.exec(text); m; m = words.exec(text)) {
      if (machine.test(tokenAround(text, m.index, m.index + m[0].length))) continue;
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const lines = lineCount(range);
      if (lines <= 1) continue;
      // Ground truth: turn the emergency breaks off on the element that owns
      // the text, re-count, put the inline style back exactly as it was.
      // Hyphenation stays untouched, so a legal break survives the probe.
      const priorWrap = parent.style.overflowWrap;
      const priorBreak = parent.style.wordBreak;
      parent.style.overflowWrap = 'normal';
      parent.style.wordBreak = 'normal';
      const legalLines = lineCount(range);
      parent.style.overflowWrap = priorWrap;
      parent.style.wordBreak = priorBreak;
      if (legalLines < lines) {
        problems.push(
          `"${m[0]}" is cut mid-word in ${label(parent)} (${lines} lines, ${legalLines} without the emergency break)`,
        );
      }
    }
  }
  return problems;
}

async function preparePage(page: Page, { billing, lang }: Case): Promise<void> {
  await page.addInitScript((l) => window.localStorage.setItem('i18nextLng', l), lang);
  await page.route('**/public/config', (r) =>
    r.fulfill({ json: { publicRegistrationEnabled: true, billingEnabled: billing, avatarEditorEnabled: false } }),
  );
  await page.route('**/public/pricing-plans', (r) => r.fulfill({ json: PLANS }));
  await page.route('**/tenants/slug-available**', (r) => r.fulfill({ json: { available: true } }));
  // `POST /auth/guest` has no trailing path segment, so `**/auth/guest/**`
  // never matched and the view was measured while its spinner was still up.
  // Status and body are the ones apps/server/src/api/routes/guests.ts sends
  // for a link that is no longer valid, so the view resolves into the same
  // localized error a user gets instead of echoing a raw code.
  await page.route('**/auth/guest*', (r) => r.fulfill({ status: 401, json: { error: 'guest_expired' } }));
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function submitStep(page: Page, completed: number): Promise<void> {
  await page.locator('form button[type=submit]').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('.pub-step__circle--completed').length >= n, completed, {
    timeout: 20_000,
  });
}

async function openView(page: Page, { view, lang }: Case): Promise<void> {
  const go = async (hash: string) => {
    await page.goto(hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pub-auth-layout__form-inner', { timeout: 20_000 });
  };
  if (view === 'login') await go('/#/login');
  else if (view === 'invite') await go('/#/invite');
  else if (view === 'guest') {
    await go('/#/guest?token=abc123');
    // The guest view auto-redeems the token on mount and shows a spinner while
    // it does. useAuthApi retries a rejected POST twice with a backoff, so the
    // error state lands the better part of a second after the first paint -
    // waiting for it is what makes this case audit the view and not its
    // spinner.
    const expired = lang === 'de' ? 'Dieser Gastlink ist abgelaufen.' : 'This guest link has expired.';
    await expect(page.getByText(expired, { exact: true })).toBeVisible({ timeout: 20_000 });
  } else if (view === 'reset93') await go(`/#/reset?token=RESETTOKEN123456&email=${encodeURIComponent(LONG_MAIL)}`);
  else if (view === 'forgot') {
    await go('/#/login');
    await page
      .getByRole('button', { name: /Passwort vergessen|Forgot password/i })
      .first()
      .click();
  } else {
    await go('/#/register');
    if (view === 'register1') return settle(page);
    const inputs = page.locator('form input');
    await inputs.nth(0).fill('Anna');
    await inputs.nth(1).fill('Beispiel');
    await inputs.nth(2).fill('anna.beispiel@firma.de');
    await inputs.nth(3).fill('Sehr-Sicheres-Passwort-1');
    await submitStep(page, 1);
    if (view === 'register2') return settle(page);
    await page.locator('form input').first().fill('Beispiel Team GmbH');
    await submitStep(page, 2);
    if (view === 'register3') return settle(page);
    const select = page
      .locator('button, [role=button]')
      .filter({ hasText: /Auswählen|Select/ })
      .first();
    if (await select.count()) await select.click();
    await page
      .locator('button')
      .filter({ hasText: /^(Weiter|Continue)$/ })
      .first()
      .click();
    await page.waitForFunction(() => document.querySelectorAll('.pub-step__circle--completed').length >= 3, null, {
      timeout: 20_000,
    });
  }
  await settle(page);
}

const CASES: Case[] = (['de', 'en'] as const).flatMap((lang) => [
  { view: 'login' as const, billing: false, lang },
  { view: 'invite' as const, billing: false, lang },
  { view: 'forgot' as const, billing: false, lang },
  { view: 'reset93' as const, billing: false, lang },
  { view: 'guest' as const, billing: false, lang },
  { view: 'register1' as const, billing: true, lang },
  { view: 'register2' as const, billing: true, lang },
  { view: 'register3' as const, billing: true, lang },
  { view: 'register4' as const, billing: true, lang },
  // Self-host default: no billing, so the wizard has three steps. This is also
  // the case that guards `.pub-btn { overflow-wrap: normal }` in public.css:
  // without the rule the button inherits `overflow-wrap: anywhere` from the
  // form, shrinks to a single character of minimum width and cuts its own
  // label apart between 1025px and 1097px. Both languages are listed on
  // purpose. Removing the rule turns the German case red in all three engines
  // and the English one in Chromium and Firefox; WebKit is the exception, it
  // hyphenates "Con-tin-ue" and so breaks the English label legally - ugly,
  // but not the defect this audit is looking for.
  { view: 'register2' as const, billing: false, lang },
]);

for (const testCase of CASES) {
  const title = `auth layout holds: ${testCase.view} (${testCase.lang}, billing=${testCase.billing})`;
  it(title, async ({ page }) => {
    test.setTimeout(120_000);
    await preparePage(page, testCase);
    await openView(page, testCase);
    const findings: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      for (const problem of await page.evaluate(auditLayout)) findings.push(`${width}px: ${problem}`);
    }
    expect(findings, `layout defects in ${title}`).toEqual([]);
  });
}

it('the form column keeps its floors and the panel is the one that gives way', async ({ page }) => {
  test.setTimeout(120_000);
  const layoutCase: Case = { view: 'login', billing: false, lang: 'de' };
  await preparePage(page, layoutCase);
  await openView(page, layoutCase);
  const geometry = async () => {
    await settle(page);
    return page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0;
      return {
        branding: Math.round(box('.pub-auth-layout__branding')),
        inner: Math.round(box('.pub-auth-layout__form-inner')),
      };
    });
  };
  // Tablet band: the form keeps 320px of content, the panel yields for it.
  await page.setViewportSize({ width: 769, height: 900 });
  const tablet = await geometry();
  expect(tablet.inner, 'form content floor at 769px').toBeGreaterThanOrEqual(320);
  expect(tablet.branding, 'panel gives way at 769px').toBeLessThan(520);
  // Narrow desktop: 220px is the width the widest headline word needs.
  await page.setViewportSize({ width: 1025, height: 900 });
  const narrow = await geometry();
  expect(narrow.inner, 'form content floor at 1025px').toBeGreaterThanOrEqual(220);
  expect(narrow.branding, 'panel gives way at 1025px').toBeLessThan(672);
  // Wide desktop: nothing yields, the panel has its full width.
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await geometry()).branding, 'panel keeps its width at 1280px').toBe(672);
});

it('the panel yields instead of pushing the page wider', async ({ page }) => {
  test.setTimeout(120_000);
  const wideCase: Case = { view: 'register2', billing: true, lang: 'de' };
  await preparePage(page, wideCase);
  await openView(page, wideCase);
  await page.setViewportSize({ width: 769, height: 900 });
  // A headline long enough that the panel cannot hold it at its own width. It
  // has to shrink below its minimum content instead of widening the document.
  await page.evaluate(() => {
    const headline = document.querySelector('.pub-auth-layout__headline');
    if (headline) headline.textContent = 'Unternehmenskommunikationsplattform Meetropolis';
  });
  await settle(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'a long brand headline must not widen the page').toBeLessThanOrEqual(1);
});
