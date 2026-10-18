'use strict';

// Vercel Node Function WebSocket entrypoint. Uses the same server-side Finnhub
// credential as the REST functions. If WebSocket service/plan limits are hit,
// the dashboard automatically falls back to paced REST quote refreshes.
const http = require('node:http');
const WebSocket = require('ws');
const { cleanSymbol } = require('../lib/finnhub');

const FINNHUB_WS = 'wss://ws.finnhub.io';
const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'Use a WebSocket connection on this endpoint.' }));
});
const wss = new WebSocket.WebSocketServer({ server, maxPayload: 8 * 1024 });

wss.on('connection', client => {
  const key = String(process.env.FINNHUB_API_KEY || '').trim();
  if (!key) { client.close(1011, 'Market data is not configured'); return; }

  let upstream;
  const subscriptions = new Set();
  let messageCount = 0;
  let windowStart = Date.now();
  const queue = [];

  try {
    const url = new URL(FINNHUB_WS);
    url.searchParams.set('token', key);
    upstream = new WebSocket(url.toString(), { handshakeTimeout: 10_000 });
  } catch {
    client.close(1011, 'Upstream connection error');
    return;
  }

  upstream.on('open', () => {
    while (queue.length && upstream.readyState === WebSocket.OPEN) upstream.send(queue.shift());
  });
  upstream.on('message', data => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });
  upstream.on('error', () => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'xk_error', message: 'Market stream connection error.' }));
  });
  upstream.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1012, 'Market stream disconnected');
  });

  client.on('message', raw => {
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; messageCount = 0; }
    if (++messageCount > 120) { client.close(1008, 'Too many subscription messages'); return; }
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || !['subscribe', 'unsubscribe'].includes(message.type)) return;
    const symbol = cleanSymbol(message.symbol);
    if (!symbol) return;

    if (message.type === 'subscribe') {
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
    const outgoing = JSON.stringify({ type: message.type, symbol });
    if (upstream.readyState === WebSocket.OPEN) upstream.send(outgoing);
    else if (upstream.readyState === WebSocket.CONNECTING) queue.push(outgoing);
  });

  const closeUpstream = () => {
    try { if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close(); } catch {}
  };
  client.on('close', closeUpstream);
  client.on('error', closeUpstream);
});

module.exports = server;
