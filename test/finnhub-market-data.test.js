'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFinnhubSnapshot, normalizeTicker } = require('../finnhub-market-data');

function fakePayload() {
  const timestamps = Array.from({ length: 80 }, (_, i) => 1_750_000_000 + i * 86_400);
  const closes = Array.from({ length: 80 }, (_, i) => 20 + i * 0.18 + Math.sin(i / 3) * 0.15);
  return {
    candles: {
      s: 'ok',
      t: timestamps,
      o: closes.map((value) => value - 0.1),
      h: closes.map((value) => value + 0.4),
      l: closes.map((value) => value - 0.4),
      c: closes,
      v: closes.map((_, i) => 1000 + i * 5),
    },
    quote: { c: 35.25, d: 0.5, dp: 1.44, h: 35.5, l: 34.6, o: 34.8, pc: 34.75, t: 1_756_000_000 },
    profile: { name: 'Example Corporation', exchange: 'NASDAQ NMS - GLOBAL MARKET', currency: 'USD' },
  };
}

test('Finnhub payload is translated to the shared evidence snapshot without exposing credentials', () => {
  const snapshot = makeFinnhubSnapshot('TEST', fakePayload());
  assert.equal(snapshot.ticker, 'TEST');
  assert.equal(snapshot.name, 'Example Corporation');
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.source, 'Finnhub Stock Candles and Quote API');
  assert.match(snapshot.sourceUrl, /^https:\/\/finnhub\.io\//);
  assert.equal(snapshot.currentPrice, 35.25);
  assert.equal(snapshot.providerQuote.changePercent, 1.44);
  assert.equal(snapshot.recentDailyBars.length, 10);
  assert.ok(Number.isFinite(snapshot.technicalEvidence.score));
  assert.equal(snapshot.historicalWalkForwardBacktest.horizonSessions, 5);
  assert.ok(snapshot.limitations.some((item) => /entitlement/i.test(item)));
  assert.equal(JSON.stringify(snapshot).includes('token='), false);
});

test('Finnhub payload rejects missing or short candle series', () => {
  assert.throws(() => makeFinnhubSnapshot('TEST', { candles: { s: 'no_data' } }), /no daily candles/i);
  assert.throws(() => makeFinnhubSnapshot('TEST', {
    candles: { s: 'ok', t: [1, 2, 3, 4], o: [1, 2, 3, 4], h: [1, 2, 3, 4], l: [1, 2, 3, 4], c: [1, 2, 3, 4], v: [1, 2, 3, 4] },
  }), /too few daily candles/i);
});

test('ticker input is normalized and URL-shaped values are rejected', () => {
  assert.equal(normalizeTicker(' jBdi '), 'JBDI');
  assert.throws(() => normalizeTicker('https://example.com'), /Ticker must be/);
});
