'use strict';
const { cleanSymbol, getResearch, getCached, setCached } = require('../lib/finnhub');

module.exports = async function researchHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const symbol = cleanSymbol(req.query?.symbol);
  if (!symbol) return res.status(400).json({ error: 'Provide a valid ticker symbol, e.g. ?symbol=NVDA' });
  const cacheKey = `research:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);
  try {
    const result = await getResearch(symbol);
    setCached(cacheKey, result);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 502).json(error.payload || { symbol, retrieved_at: new Date().toISOString(), error: error.message || 'Research request failed.', missing_fields: ['market_data'] });
  }
};
