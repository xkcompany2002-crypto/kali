'use strict';

// Finnhub-backed market data adapter. Indicator math and snapshot formatting are reused
// from the existing module so this new integration does not overwrite market-data.js.
const { normalizeTicker, makeSnapshot } = require('./market-data');

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const CACHE_TTL_MS = 60_000;
const cache = new Map();

async function fetchFinnhubJson(endpoint, params, apiKey) {
  const url = new URL(`${FINNHUB_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set('token', apiKey);

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'XK-TRADE-BOT/1.2' },
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Finnhub did not respond within 12 seconds.');
    }
    throw new Error('Could not connect to Finnhub market data.');
  }
  if (!response.ok) {
    // Do not include request URLs or provider bodies because the Finnhub token is a URL parameter.
    throw new Error(`Finnhub returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error('Finnhub returned an invalid data response.');
  }
}

function makeFinnhubSnapshot(ticker, payload) {
  const candles = payload?.candles;
  if (!candles || candles.s !== 'ok' || !Array.isArray(candles.t) || !Array.isArray(candles.c)) {
    throw new Error('Finnhub returned no daily candles for this ticker. Verify the symbol and its market-data entitlement.');
  }
  const length = Math.min(
    candles.t.length,
    candles.o?.length ?? 0,
    candles.h?.length ?? 0,
    candles.l?.length ?? 0,
    candles.c.length,
    candles.v?.length ?? 0,
  );
  if (length < 5) throw new Error('Finnhub returned too few daily candles to calculate a useful snapshot.');

  const timestamps = candles.t.slice(0, length);
  const quote = payload.quote && Number.isFinite(payload.quote.c) && payload.quote.c > 0
    ? payload.quote
    : null;
  const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
  const lastCandleTime = timestamps[length - 1];
  const regularMarketTime = quote && Number.isFinite(quote.t) && quote.t > 0
    ? quote.t : lastCandleTime;

  // Convert Finnhub's { c,h,l,o,s,t,v } candles to the established snapshot formatter's
  // internal shape. No Finnhub API key is placed in any returned field.
  const chart = {
    chart: {
      result: [{
        meta: {
          longName: typeof profile.name === 'string' && profile.name ? profile.name : ticker,
          shortName: typeof profile.name === 'string' && profile.name ? profile.name : ticker,
          currency: typeof profile.currency === 'string' ? profile.currency : null,
          fullExchangeName: typeof profile.exchange === 'string' ? profile.exchange : null,
          exchangeName: typeof profile.exchange === 'string' ? profile.exchange : null,
          instrumentType: 'EQUITY',
          regularMarketPrice: quote ? quote.c : undefined,
          regularMarketTime,
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: candles.o.slice(0, length),
            high: candles.h.slice(0, length),
            low: candles.l.slice(0, length),
            close: candles.c.slice(0, length),
            volume: candles.v.slice(0, length),
          }],
        },
      }],
      error: null,
    },
  };

  const snapshot = makeSnapshot(ticker, chart);
  snapshot.name = typeof profile.name === 'string' && profile.name ? profile.name : ticker;
  snapshot.exchange = typeof profile.exchange === 'string' && profile.exchange ? profile.exchange : null;
  snapshot.currency = typeof profile.currency === 'string' && profile.currency ? profile.currency : null;
  snapshot.source = 'Finnhub Stock Candles and Quote API';
  snapshot.sourceUrl = 'https://finnhub.io/docs/api/stock-candles';
  snapshot.marketDataTimestamp = new Date(regularMarketTime * 1000).toISOString();
  if (quote && Number.isFinite(quote.pc) && quote.pc > 0) snapshot.previousDailyClose = quote.pc;
  if (quote && Number.isFinite(quote.dp)) snapshot.priceVsPreviousClosePercent = quote.dp;
  snapshot.providerQuote = quote ? {
    currentPrice: quote.c,
    change: Number.isFinite(quote.d) ? quote.d : null,
    changePercent: Number.isFinite(quote.dp) ? quote.dp : null,
    dayHigh: Number.isFinite(quote.h) ? quote.h : null,
    dayLow: Number.isFinite(quote.l) ? quote.l : null,
    dayOpen: Number.isFinite(quote.o) ? quote.o : null,
    previousClose: Number.isFinite(quote.pc) ? quote.pc : null,
  } : null;
  snapshot.limitations = [
    'Finnhub daily candles are historical daily bars, not tick-by-tick data; quote freshness depends on the plan and exchange entitlement.',
    'Support/resistance values are rough lookback extrema, not validated order-book levels.',
    'Technical indicators describe past price action and do not predict outcomes reliably on their own.',
    'Some instruments or exchanges may require a different symbol format or a paid market-data entitlement.',
  ];
  return snapshot;
}

async function getMarketSnapshot(rawTicker) {
  const ticker = normalizeTicker(rawTicker);
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error('Finnhub is not configured. Add FINNHUB_API_KEY in the host secret settings.');

  const cached = cache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cache: 'hit' };

  const now = Math.floor(Date.now() / 1000);
  const from = now - 365 * 24 * 60 * 60;
  const [candlesResult, quoteResult, profileResult] = await Promise.allSettled([
    fetchFinnhubJson('stock/candle', { symbol: ticker, resolution: 'D', from, to: now }, apiKey),
    fetchFinnhubJson('quote', { symbol: ticker }, apiKey),
    fetchFinnhubJson('stock/profile2', { symbol: ticker }, apiKey),
  ]);

  if (candlesResult.status === 'rejected') throw candlesResult.reason;
  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
  const snapshot = makeFinnhubSnapshot(ticker, {
    candles: candlesResult.value,
    quote,
    profile,
  });
  cache.set(ticker, { value: snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...snapshot, cache: 'miss' };
}

module.exports = { normalizeTicker, makeFinnhubSnapshot, getMarketSnapshot };
