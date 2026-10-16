'use strict';

const MARKET_DATA_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const MARKET_CACHE_TTL_MS = 60_000;
const marketCache = new Map();

function normalizeTicker(value) {
  if (typeof value !== 'string') throw new Error('Enter a ticker symbol, for example AAPL or JBDI.');
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9.^=_-]{1,15}$/.test(ticker)) {
    throw new Error('Ticker must be 1–15 characters and contain only letters, numbers, dots, hyphens, underscores, or ^.');
  }
  return ticker;
}

function average(values) {
  const numbers = values.filter(Number.isFinite);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function sma(values, period) {
  return values.length >= period ? average(values.slice(-period)) : null;
}

function percentChange(values, sessions) {
  if (values.length <= sessions) return null;
  const then = values[values.length - 1 - sessions];
  const now = values[values.length - 1];
  if (!Number.isFinite(then) || !Number.isFinite(now) || then === 0) return null;
  return ((now / then) - 1) * 100;
}

function rsi14(closes) {
  if (closes.length < 15) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - 14; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const averageGain = gains / 14;
  const averageLoss = losses / 14;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
}

function realizedVolatility(closes, sessions = 20) {
  const slice = closes.slice(-(sessions + 1));
  if (slice.length < 4) return null;
  const returns = [];
  for (let i = 1; i < slice.length; i += 1) {
    if (slice[i - 1] > 0 && slice[i] > 0) returns.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (returns.length < 3) return null;
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}


function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

// Transparent heuristic score, not a calibrated probability. Uses only data at or before the supplied bar.
function calculateTechnicalEvidence(candles) {
  const bars = Array.isArray(candles) ? candles.filter((bar) => Number.isFinite(bar.close)) : [];
  const closes = bars.map((bar) => bar.close);
  const price = closes.at(-1);
  if (closes.length < 20 || !Number.isFinite(price)) {
    return { score: 0, bias: 'insufficient evidence', positiveFactors: [], negativeFactors: [], availableBars: closes.length };
  }

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const r5 = percentChange(closes, 5);
  const r20 = percentChange(closes, 20);
  const r60 = percentChange(closes, 60);
  const rsi = rsi14(closes);
  const last = bars.at(-1);
  const averageVolume20 = average(bars.slice(-20).map((bar) => bar.volume).filter(Number.isFinite));
  const relativeVolume = Number.isFinite(last.volume) && Number.isFinite(averageVolume20) && averageVolume20 > 0
    ? last.volume / averageVolume20 : null;
  const scoreFactors = [];
  const add = (label, points) => scoreFactors.push({ label, points });

  if (Number.isFinite(sma20)) add(price >= sma20 ? 'Price above SMA20' : 'Price below SMA20', price >= sma20 ? 8 : -8);
  if (Number.isFinite(sma50)) add(price >= sma50 ? 'Price above SMA50' : 'Price below SMA50', price >= sma50 ? 10 : -10);
  if (Number.isFinite(sma200)) add(price >= sma200 ? 'Price above SMA200' : 'Price below SMA200', price >= sma200 ? 10 : -10);
  if (Number.isFinite(sma20) && Number.isFinite(sma50)) add(sma20 >= sma50 ? 'SMA20 above SMA50' : 'SMA20 below SMA50', sma20 >= sma50 ? 8 : -8);
  if (Number.isFinite(sma50) && Number.isFinite(sma200)) add(sma50 >= sma200 ? 'SMA50 above SMA200' : 'SMA50 below SMA200', sma50 >= sma200 ? 8 : -8);
  if (Number.isFinite(r5)) add(`5-session return ${r5 >= 0 ? 'positive' : 'negative'}`, r5 > 0.5 ? 4 : (r5 < -0.5 ? -4 : 0));
  if (Number.isFinite(r20)) add(`20-session return ${r20 >= 0 ? 'positive' : 'negative'}`, r20 >= 5 ? 8 : (r20 > 0 ? 4 : (r20 <= -5 ? -8 : (r20 < 0 ? -4 : 0))));
  if (Number.isFinite(r60)) add(`60-session return ${r60 >= 0 ? 'positive' : 'negative'}`, r60 >= 8 ? 10 : (r60 > 0 ? 5 : (r60 <= -8 ? -10 : (r60 < 0 ? -5 : 0))));
  if (Number.isFinite(rsi)) {
    if (rsi >= 50 && rsi <= 65) add('RSI14 in constructive momentum range', 5);
    else if (rsi > 70) add('RSI14 overbought; pullback risk elevated', -5);
    else if (rsi >= 65) add('RSI14 strong but stretched', 2);
    else if (rsi < 30) add('RSI14 oversold; trend remains at risk', -2);
    else if (rsi < 45) add('RSI14 below neutral', -4);
  }
  if (Number.isFinite(relativeVolume) && relativeVolume >= 1.5 && Number.isFinite(r5) && Math.abs(r5) >= 0.5) {
    add(relativeVolume >= 1.5 ? `Relative volume elevated (${relativeVolume.toFixed(2)}x)` : 'Relative volume elevated', r5 > 0 ? 5 : -5);
  }

  const score = clamp(scoreFactors.reduce((sum, item) => sum + item.points, 0), -100, 100);
  const bias = score >= 25 ? 'bullish' : (score <= -25 ? 'bearish' : 'neutral / mixed');
  return {
    score,
    scoreScale: '-100 bearish to +100 bullish',
    bias,
    positiveFactors: scoreFactors.filter((item) => item.points > 0).sort((a, b) => b.points - a.points).slice(0, 5),
    negativeFactors: scoreFactors.filter((item) => item.points < 0).sort((a, b) => a.points - b.points).slice(0, 5),
    availableBars: closes.length,
    methodology: 'Transparent weighted technical heuristic using moving averages, 5/20/60-session momentum, RSI14 and relative volume. Not a probability and not independently validated as a profitable trading strategy.',
  };
}

function walkForwardBacktest(candles, horizon = 5) {
  const bars = Array.isArray(candles) ? candles.filter((bar) => Number.isFinite(bar.close)) : [];
  const observations = [];
  // Non-overlapping evaluation windows reduce, but do not eliminate, dependence between observations.
  for (let index = 60; index + horizon < bars.length; index += horizon) {
    const history = bars.slice(0, index + 1);
    const evidence = calculateTechnicalEvidence(history);
    if (evidence.score < 25 && evidence.score > -25) continue;
    const start = bars[index].close;
    const end = bars[index + horizon].close;
    if (!(start > 0) || !Number.isFinite(end)) continue;
    const forwardReturnPercent = ((end / start) - 1) * 100;
    if (Math.abs(forwardReturnPercent) < 0.25) continue;
    const predicted = evidence.score >= 25 ? 'up' : 'down';
    const actual = forwardReturnPercent > 0 ? 'up' : 'down';
    observations.push({ date: bars[index].date, predicted, actual, correct: predicted === actual, forwardReturnPercent: round(forwardReturnPercent, 2), score: evidence.score });
  }
  const hits = observations.filter((item) => item.correct).length;
  const sampleSize = observations.length;
  return {
    horizonSessions: horizon,
    observations: sampleSize,
    correct: hits,
    hitRatePercent: sampleSize ? round(hits / sampleSize * 100, 1) : null,
    sampleQuality: sampleSize >= 30 ? 'limited but more useful sample' : (sampleSize >= 15 ? 'small sample' : 'insufficient sample'),
    method: 'Walk-forward historical directional hit rate: calculate score using only each past window, then compare the next five-session direction. Signals near zero are excluded; overlapping windows are avoided.',
    caveats: ['In-sample historical behavior is not a forecast guarantee.', 'One year of daily data is a small sample and may reflect one market regime.', 'This hit rate ignores transaction costs, spreads, slippage, taxes, survivorship and corporate-event effects.', 'Do not generalize one ticker result to other assets or time periods.'],
    recentObservations: observations.slice(-8),
  };
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function makeSnapshot(ticker, chart) {
  const result = chart?.chart?.result?.[0];
  const error = chart?.chart?.error;
  if (error) throw new Error(String(error.description || error.code || 'Market data provider error.').slice(0, 180));
  if (!result) throw new Error('No market data was returned for this ticker. Check the symbol or try again later.');

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const candles = timestamps.map((timestamp, index) => ({
    timestamp,
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: Number.isFinite(quote.open?.[index]) ? quote.open[index] : null,
    high: Number.isFinite(quote.high?.[index]) ? quote.high[index] : null,
    low: Number.isFinite(quote.low?.[index]) ? quote.low[index] : null,
    close: Number.isFinite(quote.close?.[index]) ? quote.close[index] : null,
    volume: Number.isFinite(quote.volume?.[index]) ? quote.volume[index] : null,
  })).filter((bar) => Number.isFinite(bar.close));
  if (candles.length < 5) throw new Error('Not enough historical candles were returned to build a useful technical snapshot.');

  const closes = candles.map((bar) => bar.close);
  const recent = candles.slice(-20);
  const recent60 = candles.slice(-60);
  const volumes20 = candles.slice(-20).map((bar) => bar.volume).filter(Number.isFinite);
  const averageVolume20 = average(volumes20);
  const latestBar = candles[candles.length - 1];
  const providerPrice = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : latestBar.close;
  const providerTime = Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime : latestBar.timestamp;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const return20 = percentChange(closes, 20);
  const currentIsAbove20 = Number.isFinite(sma20) && providerPrice >= sma20;
  const currentIsAbove50 = Number.isFinite(sma50) && providerPrice >= sma50;
  const trendBias = currentIsAbove20 && currentIsAbove50 && Number.isFinite(return20) && return20 > 0
    ? 'bullish technical structure'
    : (!currentIsAbove20 && !currentIsAbove50 && Number.isFinite(return20) && return20 < 0
      ? 'bearish technical structure' : 'mixed / unconfirmed technical structure');
  const technicalEvidence = calculateTechnicalEvidence(candles);
  const walkForward = walkForwardBacktest(candles, 5);

  return {
    ticker,
    name: typeof meta.longName === 'string' ? meta.longName : (typeof meta.shortName === 'string' ? meta.shortName : ticker),
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    currency: meta.currency || null,
    instrumentType: meta.instrumentType || null,
    source: 'Yahoo Finance chart endpoint',
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history/`,
    retrievedAt: new Date().toISOString(),
    marketDataTimestamp: new Date(providerTime * 1000).toISOString(),
    latestDailyBarDate: latestBar.date,
    currentPrice: round(providerPrice, 4),
    latestDailyClose: round(latestBar.close, 4),
    previousDailyClose: candles.length > 1 ? round(candles[candles.length - 2].close, 4) : null,
    priceVsPreviousClosePercent: candles.length > 1 && candles[candles.length - 2].close !== 0
      ? round(((providerPrice / candles[candles.length - 2].close) - 1) * 100, 2) : null,
    returnsPercent: {
      sessions5: round(percentChange(closes, 5), 2),
      sessions20: round(return20, 2),
      sessions60: round(percentChange(closes, 60), 2),
    },
    technicalEvidence,
    historicalWalkForwardBacktest: walkForward,
    indicators: {
      sma20: round(sma20, 4),
      sma50: round(sma50, 4),
      sma200: round(sma200, 4),
      rsi14: round(rsi14(closes), 1),
      relativeVolume20: Number.isFinite(latestBar.volume) && Number.isFinite(averageVolume20) && averageVolume20 > 0
        ? round(latestBar.volume / averageVolume20, 2) : null,
      annualizedVolatility20Percent: round(realizedVolatility(closes, 20), 1),
      support20Approx: round(Math.min(...recent.map((bar) => bar.low ?? bar.close)), 4),
      resistance20Approx: round(Math.max(...recent.map((bar) => bar.high ?? bar.close)), 4),
      support60Approx: round(Math.min(...recent60.map((bar) => bar.low ?? bar.close)), 4),
      resistance60Approx: round(Math.max(...recent60.map((bar) => bar.high ?? bar.close)), 4),
      trendBias,
    },
    recentDailyBars: candles.slice(-10).map((bar) => ({
      date: bar.date,
      open: round(bar.open, 4), high: round(bar.high, 4), low: round(bar.low, 4), close: round(bar.close, 4), volume: bar.volume,
    })),
    limitations: [
      'This is historical/delayed public market data, not a guaranteed real-time quote.',
      'Support/resistance values are rough lookback extrema, not validated order-book levels.',
      'Technical indicators describe past price action and do not predict outcomes reliably on their own.',
    ],
  };
}

async function getMarketSnapshot(rawTicker) {
  const ticker = normalizeTicker(rawTicker);
  const cached = marketCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cache: 'hit' };

  const url = `${MARKET_DATA_BASE}${encodeURIComponent(ticker)}?range=1y&interval=1d&events=div%2Csplits`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'XK-TRADE-BOT/1.1 market-research' },
    signal: AbortSignal.timeout(12_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Market data provider returned HTTP ${response.status}.`);
  const payload = await response.json();
  const snapshot = makeSnapshot(ticker, payload);
  marketCache.set(ticker, { value: snapshot, expiresAt: Date.now() + MARKET_CACHE_TTL_MS });
  return { ...snapshot, cache: 'miss' };
}

module.exports = { normalizeTicker, getMarketSnapshot, makeSnapshot, percentChange, rsi14, realizedVolatility, sma, calculateTechnicalEvidence, walkForwardBacktest };
