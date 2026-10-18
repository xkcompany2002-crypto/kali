'use strict';

const FINNHUB_REST = 'https://finnhub.io/api/v1';
const cache = new Map();
const CACHE_TTL_MS = 10_000;

function cleanSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9.^-]{1,16}$/.test(symbol) ? symbol : null;
}

async function finnhubGet(endpoint, params = {}) {
  // TEMPORARY TESTING: key is intentionally public in this test version.
  const key = String(process.env.FINNHUB_API_KEY || 'dba3jshr01qkqqs62ru0').trim();
  if (!key) {
    const error = new Error('Market data is not configured. Set the FINNHUB_API_KEY server environment variable.');
    error.status = 503;
    throw error;
  }
  const url = new URL(`${FINNHUB_REST}/${endpoint}`);
  url.searchParams.set('token', key);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
  }
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  } catch {
    const error = new Error('Could not reach the market-data provider.');
    error.status = 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(response.status === 429
      ? 'Market-data provider rate limit reached.'
      : `Market-data provider returned HTTP ${response.status}.`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  try { return await response.json(); }
  catch {
    const error = new Error('Market-data provider returned invalid JSON.');
    error.status = 502;
    throw error;
  }
}

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() - item.at < CACHE_TTL_MS) return item.value;
  if (item) cache.delete(key);
  return null;
}
function setCached(key, value) { cache.set(key, { at: Date.now(), value }); }

async function getResearch(symbol) {
  const now = new Date();
  const to = Math.floor(now.getTime() / 1000);
  const from = Math.floor((now.getTime() - 180 * 86_400_000) / 1000);
  const iso = d => d.toISOString().slice(0, 10);
  const fromNews = iso(new Date(now.getTime() - 7 * 86_400_000));
  const toNews = iso(now);

  let quote;
  try { quote = await finnhubGet('quote', { symbol }); }
  catch (error) {
    error.payload = {
      symbol,
      retrieved_at: now.toISOString(),
      error: error.message,
      missing_fields: ['quote', 'company_profile', 'news', 'daily_candles']
    };
    throw error;
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
      })) : [];
  let candles = null;
  if (candlesResult.status === 'fulfilled' && candlesResult.value && candlesResult.value.s === 'ok') {
    const raw = candlesResult.value;
    candles = (raw.t || []).map((timestamp, index) => ({
      date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
      open: raw.o?.[index] ?? null,
      high: raw.h?.[index] ?? null,
      low: raw.l?.[index] ?? null,
      close: raw.c?.[index] ?? null,
      volume: raw.v?.[index] ?? null
    })).slice(-130);
  }

  return {
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
      ...newsData.filter(item => item.url).map(item => ({ name: item.source, url: item.url, published_at: item.published_at }))
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
}

module.exports = { cleanSymbol, finnhubGet, getResearch, getCached, setCached };
