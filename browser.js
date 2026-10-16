const dns = require('node:dns/promises');
const fs = require('node:fs');
const net = require('node:net');
const NetworkProxy = require('./network-proxy');
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  // Keep health checks and demo mode available in constrained local environments.
  // The production Docker image installs playwright-core and system Chromium.
  chromium = null;
}

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const MAX_SESSIONS = 4;
const SESSION_IDLE_MS = 8 * 60 * 1000;
const BROWSER_IDLE_CLOSE_MS = 30 * 1000;
const sessions = new Map();
const dnsCache = new Map();
let browserPromise;
let egressProxy;
let browserIdleCloseTimer;
let browserClosingPromise;
let shuttingDown = false;

const sessionIdPattern = /^[A-Za-z0-9_-]{20,80}$/;
const sensitiveActionPattern = /\b(buy now|sell now|trade now|execute (?:a )?trade|place (?:an? )?order|order now|checkout|pay now|make payment|purchase now|withdraw (?:funds|money)|transfer (?:funds|money)|delete (?:account|data|file|record)|remove (?:account|user|data|file|record)|submit (?:form|application)|send (?:message|email)|publish (?:post|article)|post comment|subscribe|sign up|sign[\s-]?in|log[\s-]?in|login|authenticate|authorize|confirm purchase|cancel order|open position|close position)\b/i;
const sensitiveActionLabelPattern = /^(?:buy|sell|trade|purchase|pay|checkout|withdraw|transfer|delete|remove|submit|send|publish|post|subscribe|sign[\s-]?in|log[\s-]?in|login|authenticate|authorize|confirm|cancel)(?:\b|$)/i;
const sensitiveAuthUrlPattern = /\/(?:sign[\s_-]?in|log[\s_-]?in|login|authenticate|auth|oauth|authorize|sign[\s_-]?up|signup|register|create[-_]?account|account)(?:\/|[?#]|$)/i;
const sensitiveActionPathPattern = /\/(?:login|log[-_]?in|sign[-_]?in|sign[-_]?up|signup|register|create[-_]?account|account|auth(?:enticate|orize)?|oauth|checkout|cart|payment|billing|orders?|trades?|buy|sell|withdraw|transfer|delete|remove|destroy|unsubscribe|submit|publish|confirm(?:ation)?)(?:\/|$)/i;

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !sessionIdPattern.test(sessionId)) {
    throw new Error('Invalid browser session. Refresh the workspace and try again.');
  }
}

function isPublicIPv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 240) return false;
  return true;
}

function isPublicIPv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    const embedded = normalized.slice('::ffff:'.length);
    if (net.isIP(embedded) === 4) return isPublicIPv4(embedded);
    return false;
  }
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')) return false;
  const firstHex = normalized.split(':')[0];
  const first = Number.parseInt(firstHex || '0', 16);
  if (!Number.isFinite(first) || first < 0x2000 || first >= 0x4000) return false;
  if (normalized.startsWith('2001:db8:') || normalized === '2001:db8') return false;
  return true;
}

function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPublicIPv4(address);
  if (version === 6) return isPublicIPv6(address);
  return false;
}

async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || host === 'metadata.google.internal') {
    throw new Error('Only public internet addresses are available in the browser.');
  }

  const directType = net.isIP(host);
  if (directType) {
    if (!isPublicAddress(host)) throw new Error('Private or reserved network addresses are blocked.');
    return;
  }

  let records = dnsCache.get(host);
  if (!records || records.expiresAt < Date.now()) {
    const resolved = await dns.lookup(host, { all: true, verbatim: true });
    records = { addresses: resolved.map((item) => item.address), expiresAt: Date.now() + 30_000 };
    dnsCache.set(host, records);
  }
  if (!records.addresses.length || records.addresses.some((address) => !isPublicAddress(address))) {
    throw new Error('This hostname does not resolve only to public internet addresses.');
  }
}

async function validateHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new Error('Please provide a valid public URL.');
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Please provide a complete HTTPS URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Only secure HTTPS public pages are available in this preview.');
  if (url.username || url.password) throw new Error('URLs containing embedded credentials are not allowed.');
  if (url.hostname.toLowerCase() === 'manus.computer' || url.hostname.toLowerCase().endsWith('.manus.computer')) {
    throw new Error('Preview and local workspace domains are blocked from the research browser.');
  }
  let safePath;
  try { safePath = decodeURIComponent(url.pathname); } catch { throw new Error('The URL path is invalid.'); }
  if (sensitiveActionPathPattern.test(safePath) || sensitiveAuthUrlPattern.test(safePath)) {
    throw new Error('Sign-in, transaction, submission, and account-action pages are blocked.');
  }
  await NetworkProxy.assertPublicHost(url.hostname);
  return url;
}

async function validateWebSocketUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Unsupported WebSocket protocol.');
  const httpUrl = new URL(url.href);
  httpUrl.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  await assertPublicHost(httpUrl.hostname);
}

async function getBrowser() {
  if (browserIdleCloseTimer) {
    clearTimeout(browserIdleCloseTimer);
    browserIdleCloseTimer = undefined;
  }
  if (browserClosingPromise) await browserClosingPromise.catch(() => {});
  if (!chromium || !fs.existsSync(CHROMIUM_PATH)) throw new Error('The isolated browser runtime is not available in this deployment.');
  if (!browserPromise) {
    browserPromise = (async () => {
      egressProxy = await NetworkProxy.createEgressProxy();
      const startedProxy = egressProxy;
      const browser = await chromium.launch({
        headless: true,
        executablePath: CHROMIUM_PATH,
        proxy: { server: egressProxy.url, bypass: '<-loopback>' },
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--disable-background-networking', '--disable-extensions', '--disable-sync', '--disable-translate', '--renderer-process-limit=1', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      });
      browser.once('disconnected', () => {
        if (egressProxy !== startedProxy) return;
        egressProxy = undefined;
        browserPromise = undefined;
        void startedProxy.close().catch(() => {});
      });
      return browser;
    })().catch(async (error) => {
      browserPromise = undefined;
      await egressProxy?.close().catch(() => {});
      egressProxy = undefined;
      throw error;
    });
  }
  return browserPromise;
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  await session.context.close().catch(() => {});
  scheduleBrowserIdleClose();
}

function cancelBrowserIdleClose() {
  if (!browserIdleCloseTimer) return;
  clearTimeout(browserIdleCloseTimer);
  browserIdleCloseTimer = undefined;
}

async function closeBrowserIfIdle() {
  if (sessions.size || shuttingDown) return;
  const pendingBrowser = browserPromise;
  const pendingProxy = egressProxy;
  if (!pendingBrowser && !pendingProxy) return;
  browserPromise = undefined;
  egressProxy = undefined;
  browserClosingPromise = (async () => {
    const browser = await pendingBrowser?.catch(() => null);
    await browser?.close().catch(() => {});
    await pendingProxy?.close().catch(() => {});
  })();
  try {
    await browserClosingPromise;
  } finally {
    browserClosingPromise = undefined;
  }
}

function scheduleBrowserIdleClose() {
  if (sessions.size || shuttingDown || browserIdleCloseTimer || (!browserPromise && !egressProxy)) return;
  browserIdleCloseTimer = setTimeout(() => {
    browserIdleCloseTimer = undefined;
    void closeBrowserIfIdle();
  }, BROWSER_IDLE_CLOSE_MS);
  browserIdleCloseTimer.unref?.();
}

async function createSession(sessionId) {
  assertSessionId(sessionId);
  cancelBrowserIdleClose();
  const current = sessions.get(sessionId);
  if (current && !current.page.isClosed()) {
    current.lastUsed = Date.now();
    return current;
  }
  if (current) await closeSession(sessionId);

  while (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (!oldest) break;
    await closeSession(oldest[0]);
  }

  cancelBrowserIdleClose();
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
    acceptDownloads: false,
    permissions: [],
    serviceWorkers: 'block',
    ignoreHTTPSErrors: false,
    storageState: { cookies: [], origins: [] },
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method()) || ['media', 'eventsource'].includes(request.resourceType())) {
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }
    const requestUrl = request.url();
    try {
      await validateHttpUrl(requestUrl);
      await route.continue();
    } catch {
      await route.abort('blockedbyclient').catch(() => {});
    }
  });
  if (typeof context.routeWebSocket !== 'function') {
    await context.close().catch(() => {});
    throw new Error('The isolated browser cannot enforce read-only WebSocket blocking.');
  }
  await context.routeWebSocket('**/*', async (socket) => { try { socket.close(); } catch {} });

  const session = { context, page: undefined, lastUsed: Date.now() };
  context.on('page', (page) => {
    if (session.page && session.page !== page) {
      void page.close().catch(() => {});
      return;
    }
    session.page = page;
    page.on('download', (download) => { void download.cancel().catch(() => {}); });
    page.on('crash', () => { session.lastError = 'The page closed unexpectedly.'; });
  });
  session.page = await context.newPage();
  sessions.set(sessionId, session);
  return session;
}

async function getExistingSession(sessionId, touch = true) {
  assertSessionId(sessionId);
  const session = sessions.get(sessionId);
  if (!session || session.page.isClosed()) return null;
  if (touch) session.lastUsed = Date.now();
  return session;
}

async function waitForPage(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(350).catch(() => {});
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function renderNewsResults(session, query, feedUrl, items) {
  const safeItems = [];
  for (const item of items.slice(0, 12)) {
    try {
      const url = await validateHttpUrl(item.link);
      if (url.protocol !== 'https:') continue;
      safeItems.push({
        title: String(item.title || 'Untitled').slice(0, 300),
        link: url.href,
        source: String(item.source || 'Google News').slice(0, 120),
        date: String(item.date || 'Date not provided').slice(0, 100),
      });
    } catch {}
  }
  session.searchResults = { query, feedUrl, items: safeItems };
  session.lastSearchResults = null;
  session.lastSearchUrl = '';
  session.displayUrl = feedUrl;
  const cards = safeItems.map((item) => `<article class="card"><div class="source">${escapeHtml(item.source)}</div><h2><a href="${escapeHtml(item.link)}">${escapeHtml(item.title)}</a></h2><p>Published: ${escapeHtml(item.date)}</p><small>${escapeHtml(item.link)}</small></article>`).join('');
  const emptyState = '<p class="empty">No public news results were returned. Try another search phrase or open a source URL directly.</p>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google News · ${escapeHtml(query)}</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font:14px/1.5 Arial,sans-serif;color:#e7f2ee;background:#091617}body{padding:22px 18px 32px}.heading{max-width:900px;margin:0 auto 17px}.eyebrow{color:#65c6a7;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.heading h1{margin:6px 0;color:#e7f2ee;font-size:22px;font-weight:600}.heading p{margin:0;color:#8ca49d;font-size:11px}.results{display:grid;max-width:900px;gap:9px;margin:auto}.card{padding:13px 14px;border:1px solid rgba(159,207,196,.15);border-radius:10px;background:linear-gradient(145deg,#10292b,#0c2022)}.source{margin-bottom:4px;color:#80cbb2;font-size:10px;font-weight:600}.card h2{margin:0 0 7px;font-size:14px;font-weight:500;line-height:1.45}.card a{color:#dcebe5;text-decoration:none}.card a:hover{color:#75e4c1;text-decoration:underline}.card p{margin:0 0 4px;color:#879e97;font-size:10px}.card small{display:block;overflow-wrap:anywhere;color:#617c74;font-size:9px}.empty{padding:20px;border:1px solid rgba(159,207,196,.14);border-radius:10px;color:#9aafaa;background:#102326}.foot{max-width:900px;margin:13px auto 0;color:#668078;font-size:9px}</style></head><body><header class="heading"><div class="eyebrow">Public news search</div><h1>${escapeHtml(query)}</h1><p>Google News public feed · Open a headline to inspect its source. Search results are leads, not verified facts.</p></header><main class="results">${cards || emptyState}</main><footer class="foot">Open the original article and check its date and source before relying on a headline.</footer></body></html>`;
  await session.page.goto('about:blank');
  await session.page.setContent(html, { waitUntil: 'domcontentloaded' });
}

async function state(sessionId) {
  const session = await getExistingSession(sessionId, false);
  if (!session) return { active: false, title: '', url: '' };
  let title = '';
  try { title = await session.page.title(); } catch {}
  return { active: Boolean(session.searchResults) || session.page.url() !== 'about:blank', title: title.slice(0, 180), url: session.displayUrl || session.page.url() };
}

async function open(sessionId, rawUrl) {
  const url = await validateHttpUrl(rawUrl);
  const session = await createSession(sessionId);
  session.lastError = '';
  session.searchResults = null;
  session.lastSearchResults = null;
  session.displayUrl = '';
  await session.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await waitForPage(session.page);
  if (url.hostname === 'news.google.com' && url.pathname === '/rss/search') {
    const items = await session.page.evaluate(() => Array.from(document.querySelectorAll('item')).slice(0, 12).map((item) => ({
      title: item.querySelector('title')?.textContent?.trim() || '',
      link: item.querySelector('link')?.textContent?.trim() || '',
      date: item.querySelector('pubDate')?.textContent?.trim() || '',
      source: item.querySelector('source')?.textContent?.trim() || 'Google News',
    })));
    await renderNewsResults(session, url.searchParams.get('q') || 'Market news', url.href, items);
  }
  return state(sessionId);
}

async function search(sessionId, query) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 400) throw new Error('Search terms must be between 1 and 400 characters.');
  const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query.trim())}&hl=en-US&gl=US&ceid=US:en`;
  return open(sessionId, searchUrl);
}

async function readPage(sessionId) {
  const session = await getExistingSession(sessionId);
  if (!session || (session.page.url() === 'about:blank' && !session.searchResults)) return { error: 'No page is open. Search or open a public URL first.' };
  let text = '';
  try {
    await waitForPage(session.page);
    text = await session.page.locator('body').innerText({ timeout: 8_000 });
  } catch {
    return { error: 'The page text could not be read. It may be blocked or still loading.', ...(await state(sessionId)) };
  }
  const readableText = text.trim();
  if (!readableText) return { error: 'This page has no readable visible text in the browser. It may require human verification or block automated access; the prototype will not bypass those controls.', ...(await state(sessionId)) };
  const clipped = readableText.slice(0, 12_000);
  return { ...(await state(sessionId)), text: clipped, truncated: readableText.length > clipped.length };
}

function isSensitiveAction(label, href = '') {
  const normalizedLabel = String(label || '').replace(/\s+/g, ' ').trim();
  const normalizedHref = String(href || '');
  return sensitiveActionLabelPattern.test(normalizedLabel)
    || sensitiveActionPattern.test(`${normalizedLabel} ${normalizedHref}`)
    || sensitiveAuthUrlPattern.test(normalizedHref);
}

async function validatePublicLink(rawHref, baseUrl) {
  if (typeof rawHref !== 'string' || !rawHref.trim() || rawHref.trim().startsWith('#')) {
    throw new Error('In-page actions are disabled. Use the browser scroll control instead.');
  }
  if (/^(javascript|data|file):/i.test(rawHref.trim())) throw new Error('Script, data, and local-file links are blocked.');
  const target = new URL(rawHref.trim(), baseUrl);
  if (isSensitiveAction('', target.href)) throw new Error('Sign-in and sensitive-action links are disabled.');
  return validateHttpUrl(target.href);
}

async function navigateToPublicLink(sessionId, session, safeUrl) {
  const previousSearch = session.searchResults;
  const previousSearchUrl = session.displayUrl;
  await session.page.goto(safeUrl.href, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await waitForPage(session.page);
  session.searchResults = null;
  session.displayUrl = '';
  if (previousSearch) {
    session.lastSearchResults = previousSearch;
    session.lastSearchUrl = previousSearchUrl;
  } else {
    session.lastSearchResults = null;
    session.lastSearchUrl = '';
  }
  return state(sessionId);
}

async function click(sessionId, target) {
  if (typeof target !== 'string' || !target.trim() || target.trim().length > 120) throw new Error('Provide the visible text of one public link.');
  const session = await getExistingSession(sessionId);
  if (!session || (session.page.url() === 'about:blank' && !session.searchResults)) return { error: 'No page is open.' };
  const page = session.page;
  const name = target.trim();

  const links = page.getByRole('link', { name, exact: false });
  if (await links.count()) {
    const link = links.first();
    if (!await link.isVisible().catch(() => false)) return { error: 'That link is not visible.' };
    const info = await link.evaluate((element) => {
      let node = element;
      let inlineHandler = false;
      while (node && node !== document) {
        if (Array.from(node.attributes || []).some((attribute) => /^on/i.test(attribute.name))) inlineHandler = true;
        node = node.parentElement;
      }
      return {
        label: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 180),
        href: element.getAttribute('href') || '',
        inForm: Boolean(element.closest('form')),
        download: element.hasAttribute('download'),
        inlineHandler,
      };
    });
    if (info.inForm) return { blocked: true, reason: 'Links inside forms are disabled.' };
    if (info.download || info.inlineHandler) return { blocked: true, reason: 'This page link is not a plain public navigation link.' };
    if (isSensitiveAction(info.label, info.href)) return { blocked: true, reason: 'This looks like a sign-in, account, transaction, submission, or other sensitive action. The prototype will not open it.' };
    try {
      const safeUrl = await validatePublicLink(info.href, page.url());
      return await navigateToPublicLink(sessionId, session, safeUrl);
    } catch (error) {
      return { blocked: true, reason: error.message || 'This public link could not be safely opened.' };
    }
  }

  return { error: `No visible public link matched “${name}”. Try a shorter visible label.` };
}

async function scroll(sessionId, direction) {
  if (!['up', 'down'].includes(direction)) throw new Error('Scroll direction must be up or down.');
  const session = await getExistingSession(sessionId);
  if (!session || (session.page.url() === 'about:blank' && !session.searchResults)) return { error: 'No page is open.' };
  await session.page.evaluate((way) => window.scrollBy({ top: way === 'down' ? Math.max(500, window.innerHeight * 0.75) : -Math.max(500, window.innerHeight * 0.75), behavior: 'smooth' }), direction);
  await waitForPage(session.page);
  return state(sessionId);
}

async function control(sessionId, input) {
  assertSessionId(sessionId);
  if (!input || !['move', 'click', 'scroll'].includes(input.action)) throw new Error('Only pointer movement, scrolling, and public-link clicks are available.');
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 1 || input.y < 0 || input.y > 1) {
    throw new Error('Pointer coordinates are invalid.');
  }
  if (input.action === 'scroll' && (!Number.isFinite(input.deltaY) || input.deltaY === 0 || Math.abs(input.deltaY) > 900)) {
    throw new Error('Scroll distance is invalid.');
  }

  const session = await getExistingSession(sessionId);
  if (!session || (session.page.url() === 'about:blank' && !session.searchResults)) return { error: 'No page is open.' };
  const page = session.page;
  const viewport = page.viewportSize();
  if (!viewport) return { error: 'The browser viewport is not available.' };
  const x = Math.max(0, Math.min(viewport.width - 1, Math.round(input.x * viewport.width)));
  const y = Math.max(0, Math.min(viewport.height - 1, Math.round(input.y * viewport.height)));
  await page.mouse.move(x, y);

  if (input.action === 'move') return { ok: true };
  if (input.action === 'scroll') {
    await page.mouse.wheel(0, Math.trunc(input.deltaY));
    return { ok: true };
  }

  const target = await page.evaluate(({ pointX, pointY }) => {
    const element = document.elementFromPoint(pointX, pointY);
    const anchor = element?.closest('a[href]');
    let inlineHandler = false;
    let node = anchor;
    while (node && node !== document) {
      if (Array.from(node.attributes || []).some((attribute) => /^on/i.test(attribute.name))) inlineHandler = true;
      node = node.parentElement;
    }
    return {
      anchor: Boolean(anchor),
      inForm: Boolean(element?.closest('form')),
      label: (anchor?.innerText || anchor?.getAttribute('aria-label') || '').trim().slice(0, 180),
      href: anchor?.getAttribute('href') || '',
      download: Boolean(anchor?.hasAttribute('download')),
      inlineHandler,
    };
  }, { pointX: x, pointY: y });

  if (!target.anchor) return { blocked: true, reason: 'Manual control can open public links only. Form fields, buttons, and other page actions remain disabled.' };
  if (target.inForm) return { blocked: true, reason: 'Links inside forms are disabled in manual-control mode.' };
  if (target.download || target.inlineHandler) return { blocked: true, reason: 'This page link is not a plain public navigation link.' };
  if (isSensitiveAction(target.label, target.href)) return { blocked: true, reason: 'This link appears related to a sensitive account, transaction, or submission action and was not opened.' };
  try {
    const safeUrl = await validatePublicLink(target.href, page.url());
    const result = await navigateToPublicLink(sessionId, session, safeUrl);
    return result;
  } catch (error) {
    return { blocked: true, reason: error.message };
  }
}

async function back(sessionId) {
  const session = await getExistingSession(sessionId);
  if (!session || (session.page.url() === 'about:blank' && !session.searchResults && !session.lastSearchResults)) return { error: 'No page is open.' };
  if (session.searchResults) {
    const feedUrl = session.searchResults.feedUrl;
    await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null);
    if (session.page.url() === feedUrl) await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null);
    session.searchResults = null;
    session.displayUrl = '';
    await waitForPage(session.page);
    return state(sessionId);
  }
  await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null);
  await waitForPage(session.page);
  if (session.lastSearchResults && session.page.url() === 'about:blank') {
    const previous = session.lastSearchResults;
    const previousUrl = session.lastSearchUrl;
    await renderNewsResults(session, previous.query, previousUrl, previous.items);
  } else {
    session.lastSearchResults = null;
    session.lastSearchUrl = '';
  }
  return state(sessionId);
}

async function screenshot(sessionId) {
  const session = await getExistingSession(sessionId, false);
  if (!session || (session.page.url() === 'about:blank' && !session.searchResults)) return null;
  try {
    return await session.page.screenshot({ type: 'jpeg', quality: 55, timeout: 8_000, animations: 'disabled', caret: 'hide' });
  } catch {
    return null;
  }
}

async function browserAvailable() {
  return fs.existsSync(CHROMIUM_PATH) && typeof chromium.launch === 'function';
}

const cleanup = setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [sessionId, session] of sessions) {
    if (session.lastUsed < cutoff) void closeSession(sessionId);
  }
}, 60_000);
cleanup.unref();

async function shutdown() {
  shuttingDown = true;
  cancelBrowserIdleClose();
  await Promise.all([...sessions.keys()].map(closeSession));
  await browserClosingPromise?.catch(() => {});
  const browser = await browserPromise?.catch(() => null);
  await browser?.close().catch(() => {});
  await egressProxy?.close().catch(() => {});
  egressProxy = undefined;
  browserPromise = undefined;
}

module.exports = { back, browserAvailable, click, closeSession, control, open, readPage, screenshot, search, shutdown, state, scroll };
