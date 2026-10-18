'use strict';
const { cleanSymbol, finnhubGet, getCached, setCached } = require('../../lib/finnhub');

module.exports = async function quoteHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const symbol = cleanSymbol(req.query?.symbol);
  if (!symbol) return res.status(400).json({ error: 'Provide a valid ticker symbol.' });
  const cacheKey = `quote:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);
  try {
    const result = await finnhubGet('quote', { symbol });
    setCached(cacheKey, result);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.message || 'Quote request failed.' });
  }
};
