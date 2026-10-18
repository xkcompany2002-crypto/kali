'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const FINNHUB_KEY = String(process.env.FINNHUB_API_KEY || '').trim();
const FINNHUB_REST = 'https://finnhub.io/api/v1';
const FINNHUB_WS = 'wss://ws.finnhub.io';
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!FINNHUB_KEY) {
  console.warn('[XK StockStream] FINNHUB_API_KEY is not configured. Market API calls will return a setup error.');
}

app.disable('x-powered-by');
// On managed hosts behind one trusted reverse proxy, req.ip resolves the client address.
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  etag: true,
  maxAge: '5m'
}));

// Lightweight per-IP limiter for the public JSON endpoint.
const requestBuckets = new Map();
function rateLimit(maxRequests = 60, windowMs = 60_000) {
  return (req, res, next) => {
    const now = Date.now();
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    let bucket = requestBuckets.get(ip);
    if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
    bucket.count++;
    requestBuckets.set(ip, bucket);
    if (requestBuckets.size > 4000) {
      for (const [key, val] of requestBuckets) if (now - val.start > windowMs * 2) requestBuckets.delete(key);
    }
    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Rate limit exceeded; retry shortly.' });
    }
    next();
  };
}
app.use('/api', rateLimit(60));

const cache = new Map();
const cacheTtlMs = 10_000;

async function finnhubGet(endpoint, params = {}) {
  if (!FINNHUB_KEY) {
    const err = new Error('Market data is not configured on this server.');
    err.status = 503;
    throw err;
  }
  const url = new URL(`${FINNHUB_REST}/${endpoint}`);
  url.searchParams.set('token', FINNHUB_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    const err = new Error('Could not reach the market-data provider.');
    err.status = 502;
    throw err;
  }
  if (!response.ok) {
    const err = new Error(response.status === 429
      ? 'Market-data provider rate limit reached.'
      : `Market-data provider returned HTTP ${response.status}.`);
    err.status = response.status === 429 ? 429 : 502;
    throw err;
  }
  try {
    return await response.json();
  } catch {
    const err = new Error('Market-data provider returned invalid JSON.');
    err.status = 502;
    throw err;
  }
}

function cleanSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) return null;
  return symbol;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'StockStream Global',
    marketProviderConfigured: Boolean(FINNHUB_KEY),
    researchEndpoint: '/api/research?symbol=NVDA',
    serverTime: new Date().toISOString()
  });
});

// Existing frontend-compatible quote endpoint; token is attached server-side.
app.get('/api/v1/quote', async (req, res) => {
  const symbol = cleanSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json({ error: 'Provide a valid ticker symbol.' });
  const cacheKey = `quote:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < cacheTtlMs) return res.json(cached.value);
  try {
    const quote = await finnhubGet('quote', { symbol });
    cache.set(cacheKey, { at: Date.now(), value: quote });
    res.setHeader('Cache-Control', 'no-store');
    res.json(quote);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'Quote request failed.' });
  }
});

// Qwen/controller-readable endpoint. Returns actual retrieved values and explicit gaps.
app.get('/api/research', async (req, res) => {
  const symbol = cleanSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json({ error: 'Provide a valid ticker symbol, e.g. ?symbol=NVDA' });
  res.setHeader('Cache-Control', 'no-store');
  const cacheKey = `research:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < cacheTtlMs) return res.json(cached.value);

  const now = new Date();
  const to = Math.floor(now.getTime() / 1000);
  const fromDate = new Date(now.getTime() - 180 * 86400000);
  const from = Math.floor(fromDate.getTime() / 1000);
  const iso = date => date.toISOString().slice(0, 10);
  const fromNews = iso(new Date(now.getTime() - 7 * 86400000));
  const toNews = iso(now);

  let quote;
  try {
    quote = await finnhubGet('quote', { symbol });
  } catch (error) {
    return res.status(error.status || 502).json({
      symbol,
      retrieved_at: now.toISOString(),
      error: error.message || 'Could not retrieve quote.',
      missing_fields: ['quote', 'company_profile', 'news', 'daily_candles']
    });
  }

  const [profileResult, newsResult, candlesResult] = await Promise.allSettled([
    finnhubGet('stock/profile2', { symbol }),
    finnhubGet('company-news', { symbol, from: fromNews, to: toNews }),
    finnhubGet('stock/candle', { symbol, resolution: 'D', from, to })
  ]);

  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
  const newsData = newsResult.status === 'fulfilled' && Array.isArray(newsResult.value)
    ? newsResult.value.slice(0, 15).map(item => ({
        headline: String(item.headline || '').slice(0, 300),
        summary: String(item.summary || '').slice(0, 1200),
        source: String(item.source || 'Unknown'),
        published_at: item.datetime ? new Date(Number(item.datetime) * 1000).toISOString() : null,
        url: /^https?:\/\//i.test(String(item.url || '')) ? item.url : null
      }))
    : [];
  let candles = null;
  if (candlesResult.status === 'fulfilled' && candlesResult.value && candlesResult.value.s === 'ok') {
    const raw = candlesResult.value;
    candles = (raw.t || []).map((t, i) => ({
      date: new Date(Number(t) * 1000).toISOString().slice(0, 10),
      open: raw.o?.[i] ?? null,
      high: raw.h?.[i] ?? null,
      low: raw.l?.[i] ?? null,
      close: raw.c?.[i] ?? null,
      volume: raw.v?.[i] ?? null
    })).slice(-130);
  }

  const output = {
    product: 'StockStream Global / XK-TRADE-BOT research source',
    ticker: symbol,
    retrieved_at: new Date().toISOString(),
    provider: 'Finnhub',
    data_delay_note: 'Quote freshness and historical access depend on the provider, exchange, and account entitlements. Do not assume every value is real-time.',
    quote: {
      current: quote?.c ?? null,
      change: quote?.d ?? null,
      change_percent: quote?.dp ?? null,
      high: quote?.h ?? null,
      low: quote?.l ?? null,
      open: quote?.o ?? null,
      previous_close: quote?.pc ?? null,
      provider_timestamp: quote?.t ? new Date(Number(quote.t) * 1000).toISOString() : null,
      source_url: 'https://finnhub.io/'
    },
    company_profile: profile && Object.keys(profile).length ? {
      name: profile.name || null,
      ticker: profile.ticker || symbol,
      exchange: profile.exchange || null,
      currency: profile.currency || null,
      industry: profile.finnhubIndustry || null,
      market_capitalization: profile.marketCapitalization ?? null,
      website: profile.weburl || null
    } : null,
    news_period: { from: fromNews, to: toNews },
    news: newsData,
    daily_candles: candles,
    sources: [
      { name: 'Finnhub', url: 'https://finnhub.io/', role: 'market data provider' },
      ...newsData.filter(n => n.url).map(n => ({ name: n.source, url: n.url, published_at: n.published_at }))
    ],
    missing_fields: [
      ...(profileResult.status === 'rejected' ? ['company_profile'] : []),
      ...(newsResult.status === 'rejected' ? ['news'] : []),
      ...(candlesResult.status === 'rejected' || !candles ? ['daily_candles'] : []),
      ...((quote?.c == null || Number(quote.c) <= 0) ? ['valid_current_quote'] : [])
    ],
    endpoint_notes: [
      'This endpoint returns provider-retrieved information, not personalized investment advice.',
      'Never assume missing data. Use source links and timestamps as returned.'
    ]
  };

  cache.set(cacheKey, { at: Date.now(), value: output });
  res.json(output);
});

// WebSocket relay: keeps the Finnhub key on the server, not in the browser HTML.
const wss = new WebSocket.WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  if (!FINNHUB_KEY) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client, req));
});

wss.on('connection', client => {
  let upstream;
  const subscriptions = new Set();
  let msgCount = 0;
  let windowStart = Date.now();

  try {
    const url = new URL(FINNHUB_WS);
    url.searchParams.set('token', FINNHUB_KEY);
    upstream = new WebSocket(url.toString(), { handshakeTimeout: 10_000 });
  } catch {
    client.close(1011, 'Upstream connection error');
    return;
  }

  const upstreamQueue = [];
  upstream.on('open', () => {
    for (const message of upstreamQueue.splice(0)) upstream.send(message);
  });
  upstream.on('message', data => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });
  upstream.on('error', () => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'xk_error', message: 'Market stream connection error.' }));
    }
  });
  upstream.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1012, 'Market stream disconnected');
  });

  client.on('message', raw => {
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; msgCount = 0; }
    msgCount++;
    if (msgCount > 120) {
      client.close(1008, 'Too many subscription messages');
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || !['subscribe', 'unsubscribe'].includes(msg.type)) return;
    const symbol = cleanSymbol(msg.symbol);
    if (!symbol) return;

    if (msg.type === 'subscribe') {
      if (!subscriptions.has(symbol) && subscriptions.size >= 30) {
        client.send(JSON.stringify({ type: 'xk_error', message: 'Subscription limit reached (30 symbols per connection).' }));
        return;
      }
      if (subscriptions.has(symbol)) return;
      subscriptions.add(symbol);
    } else {
      if (!subscriptions.has(symbol)) return;
      subscriptions.delete(symbol);
    }

    const outgoing = JSON.stringify({ type: msg.type, symbol });
    if (upstream.readyState === WebSocket.OPEN) upstream.send(outgoing);
    else if (upstream.readyState === WebSocket.CONNECTING) upstreamQueue.push(outgoing);
  });

  client.on('close', () => {
    try { if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close(); } catch {}
  });
  client.on('error', () => {
    try { if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close(); } catch {}
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[StockStream] listening on port ${PORT}; Finnhub key configured: ${Boolean(FINNHUB_KEY)}`);
});
