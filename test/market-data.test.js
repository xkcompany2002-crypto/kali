const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTicker, makeSnapshot, percentChange, rsi14, sma, calculateTechnicalEvidence, walkForwardBacktest } = require('../market-data');

test('ticker validation normalizes safe ticker symbols and rejects URL-shaped input', () => {
  assert.equal(normalizeTicker(' jBdi '), 'JBDI');
  assert.equal(normalizeTicker('BRK-B'), 'BRK-B');
  assert.throws(() => normalizeTicker('https://example.com'), /Ticker must be/);
  assert.throws(() => normalizeTicker('AAPL;curl'), /Ticker must be/);
});

test('technical calculations are deterministic and handle missing history', () => {
  assert.equal(sma([1, 2, 3, 4], 3), 3);
  assert.equal(sma([1, 2], 3), null);
  assert.equal(percentChange([10, 11, 12, 13, 15, 20], 5), 100);
  assert.equal(rsi14(Array.from({ length: 15 }, (_, index) => 100 + index)), 100);
  assert.equal(rsi14([100, 101, 102]), null);
});

test('market snapshot includes timestamps, sourced price history and technical levels', () => {
  const timestamps = Array.from({ length: 70 }, (_, i) => 1_700_000_000 + i * 86_400);
  const close = Array.from({ length: 70 }, (_, i) => 20 + i * 0.25 + Math.sin(i) * 0.2);
  const chart = { chart: { result: [{
    meta: { longName: 'Example Inc.', currency: 'USD', fullExchangeName: 'NASDAQ', instrumentType: 'EQUITY', regularMarketPrice: close.at(-1), regularMarketTime: timestamps.at(-1) },
    timestamp: timestamps,
    indicators: { quote: [{
      open: close.map((v) => v - 0.1), high: close.map((v) => v + 0.4), low: close.map((v) => v - 0.4), close, volume: close.map((_, i) => 1000 + i * 4),
    }] },
  }], error: null } };
  const snapshot = makeSnapshot('TEST', chart);
  assert.equal(snapshot.ticker, 'TEST');
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.recentDailyBars.length, 10);
  assert.ok(snapshot.indicators.sma20 > snapshot.indicators.sma50);
  assert.ok(snapshot.technicalEvidence);
  assert.ok(Number.isFinite(snapshot.technicalEvidence.score));
  assert.equal(snapshot.historicalWalkForwardBacktest.horizonSessions, 5);
  assert.ok(Number.isFinite(snapshot.indicators.rsi14));
  assert.ok(snapshot.sourceUrl.includes('TEST'));
  assert.ok(snapshot.marketDataTimestamp);
  assert.ok(snapshot.limitations.length >= 3);
});


test('technical evidence score is bounded, directional, and explicitly not a probability', () => {
  const candles = Array.from({ length: 220 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 20 + index * 0.18,
    high: 20 + index * 0.18 + 0.3,
    low: 20 + index * 0.18 - 0.3,
    volume: 1000 + index,
  }));
  const evidence = calculateTechnicalEvidence(candles);
  assert.ok(evidence.score >= -100 && evidence.score <= 100);
  assert.equal(evidence.bias, 'bullish');
  assert.match(evidence.methodology, /not a probability/i);
  assert.ok(evidence.positiveFactors.length > 0);
});

test('walk-forward backtest uses a documented horizon and reports its sample size', () => {
  const candles = Array.from({ length: 250 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 30 + index * 0.09 + Math.sin(index / 4) * 1.1,
    high: 31 + index * 0.09 + Math.sin(index / 4) * 1.1,
    low: 29 + index * 0.09 + Math.sin(index / 4) * 1.1,
    volume: 1000 + Math.cos(index) * 120,
  }));
  const result = walkForwardBacktest(candles);
  assert.equal(result.horizonSessions, 5);
  assert.ok(Number.isInteger(result.observations) && result.observations >= 0);
  assert.ok(['insufficient sample', 'small sample', 'limited but more useful sample'].includes(result.sampleQuality));
  assert.ok(result.caveats.length >= 3);
});
