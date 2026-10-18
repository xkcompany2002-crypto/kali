'use strict';

module.exports = function health(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    service: 'StockStream Global',
    marketProviderConfigured: Boolean(String(process.env.FINNHUB_API_KEY || '').trim()),
    researchEndpoint: '/api/research?symbol=NVDA',
    serverTime: new Date().toISOString()
  });
};
