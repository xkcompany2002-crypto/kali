const dns = require('node:dns/promises');
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');

function blockedError(message) {
  return Object.assign(new Error(message), { code: 'BLOCKED' });
}

function isPublicIPv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 31 && c === 196) return false;
  if (a === 192 && b === 52 && c === 193) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 240) return false;
  return true;
}

function isPublicIPv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    const embedded = normalized.slice('::ffff:'.length);
    if (net.isIP(embedded) === 4) return isPublicIPv4(embedded);
    return false;
  }
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')) return false;
  const [firstHex, secondHex] = normalized.split(':');
  const first = Number.parseInt(firstHex || '0', 16);
  const second = Number.parseInt(secondHex || '0', 16);
  if (!Number.isFinite(first) || first < 0x2000 || first >= 0x4000) return false;
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002) return false;
  return true;
}

function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPublicIPv4(address);
  if (version === 6) return isPublicIPv6(address);
  return false;
}

function normalizedHost(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

async function resolvePublicHost(hostname) {
  const host = normalizedHost(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.arpa') || host === 'metadata.google.internal' || host === 'manus.computer' || host.endsWith('.manus.computer')) {
    throw blockedError('Only public internet addresses are available in the browser.');
  }

  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw blockedError('Private or reserved network addresses are blocked.');
    return [host];
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw Object.assign(new Error('The public hostname could not be resolved.'), { code: 'BAD_GATEWAY' });
  }
  const addresses = [...new Set(records.map((record) => record.address))];
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw blockedError('This hostname does not resolve only to public internet addresses.');
  }
  return addresses;
}

async function assertPublicHost(hostname) {
  await resolvePublicHost(hostname);
}

function configuredUpstreamProxy() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return null;

  let url;
  try { url = new URL(raw); } catch { throw new Error('The configured upstream proxy is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The configured upstream proxy is invalid.');
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The configured upstream proxy is invalid.');

  let authorization = '';
  if (url.username || url.password) {
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    authorization = `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}\r\n`;
  }
  return { protocol: url.protocol, hostname: url.hostname, port, authorization };
}

function parseAuthority(authority, fallbackPort) {
  if (typeof authority !== 'string' || authority.length > 300) throw blockedError('Invalid proxy destination.');
  let parsed;
  try { parsed = new URL(`http://${authority}`); } catch { throw blockedError('Invalid proxy destination.'); }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw blockedError('Invalid proxy destination.');
  }
  const port = Number(parsed.port || fallbackPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw blockedError('Invalid network port.');
  if (port !== 443) throw blockedError('Only HTTPS connections on port 443 are allowed.');
  return { hostname: parsed.hostname, port };
}

function isLoopbackPeer(address) {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

function sendSocketError(socket, status) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function sendHttpError(response, status, message) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'close',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(message);
}

function connectSocket(port, addresses) {
  return new Promise((resolve, reject) => {
    let lastError;
    let index = 0;

    const tryNext = () => {
      if (index >= addresses.length) {
        reject(lastError || new Error('Could not connect to the public host.'));
        return;
      }
      const address = addresses[index++];
      const socket = net.connect({ host: address, port, family: net.isIP(address) });
      let settled = false;
      const timer = setTimeout(() => socket.destroy(new Error('Connection timed out.')), 8_000);
      const onError = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        lastError = error;
        socket.removeListener('connect', onConnect);
        socket.destroy();
        tryNext();
      };
      const onConnect = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener('error', onError);
        socket.setTimeout(0);
        socket.on('error', () => {});
        resolve(socket);
      };
      socket.once('connect', onConnect);
      socket.on('error', onError);
    };

    tryNext();
  });
}

function connectConfiguredProxy(proxyConfig) {
  return connectSocket(proxyConfig.port, [proxyConfig.hostname]).then((socket) => {
    if (proxyConfig.protocol !== 'https:') return socket;
    const secure = tls.connect({ socket, servername: proxyConfig.hostname, rejectUnauthorized: true });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => secure.destroy(new Error('Upstream proxy TLS timed out.')), 8_000);
      secure.once('secureConnect', () => { clearTimeout(timer); resolve(secure); });
      secure.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
  });
}

function requestUpstreamTunnel(socket, target, authorization) {
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('The upstream proxy did not answer.')), 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('end', onEnd);
    };
    const finish = (error, remainder) => {
      cleanup();
      if (error) reject(error);
      else resolve(remainder);
    };
    const onError = () => finish(new Error('The upstream proxy connection failed.'));
    const onEnd = () => finish(new Error('The upstream proxy closed the connection.'));
    const onData = (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 16_384) return finish(new Error('The upstream proxy response was too large.'));
      const boundary = response.indexOf('\r\n\r\n');
      if (boundary === -1) return;
      const headers = response.subarray(0, boundary).toString('latin1');
      const status = Number(headers.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)?.[1] || 0);
      if (status !== 200) return finish(new Error('The upstream proxy declined the HTTPS tunnel.'));
      finish(null, response.subarray(boundary + 4));
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
    const request = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Connection: Keep-Alive\r\n${authorization}\r\n`;
    socket.write(request);
  });
}

function forwardHttp(_request, response) {
  sendHttpError(response, 403, 'Plain HTTP is disabled. Only HTTPS connections to public destinations on port 443 are allowed.');
}

async function forwardConnect(request, client, head, sockets) {
  let upstream;
  try {
    const { hostname, port } = parseAuthority(request.url, 443);
    const addresses = await resolvePublicHost(hostname);
    if (client.destroyed) return;

    const proxyConfig = configuredUpstreamProxy();
    let remainder = Buffer.alloc(0);
    if (proxyConfig) {
      let lastError;
      for (const address of addresses.slice(0, 2)) {
        try {
          upstream = await connectConfiguredProxy(proxyConfig);
          remainder = await requestUpstreamTunnel(upstream, `${address.includes(':') ? `[${address}]` : address}:${port}`, proxyConfig.authorization);
          break;
        } catch (error) {
          upstream?.destroy();
          upstream = undefined;
          lastError = error;
        }
      }
      if (!upstream) throw lastError || new Error('Could not establish a secure upstream tunnel.');
    } else {
      upstream = await connectSocket(port, addresses);
    }

    if (client.destroyed) { upstream.destroy(); return; }
    sockets.add(upstream);
    upstream.once('close', () => sockets.delete(upstream));
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Market Lens\r\n\r\n');
    if (remainder.length) client.write(remainder);
    if (head?.length) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
    client.once('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  } catch (error) {
    upstream?.destroy();
    if (!client.destroyed) sendSocketError(client, error.code === 'BLOCKED' ? '403 Forbidden' : '502 Bad Gateway');
  }
}

function forwardUpgrade(_request, client) {
  sendSocketError(client, '403 Forbidden');
}

function createEgressProxy() {
  const sockets = new Set();
  const proxy = http.createServer((request, response) => { void forwardHttp(request, response); });
  proxy.on('connection', (socket) => {
    if (!isLoopbackPeer(socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  proxy.on('connect', (request, client, head) => { void forwardConnect(request, client, head, sockets); });
  proxy.on('upgrade', (request, client) => { void forwardUpgrade(request, client); });
  proxy.on('clientError', (_error, socket) => sendSocketError(socket, '400 Bad Request'));

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    proxy.once('error', onError);
    proxy.listen(0, '127.0.0.1', () => {
      proxy.removeListener('error', onError);
      const address = proxy.address();
      if (!address || typeof address === 'string') {
        proxy.close();
        reject(new Error('The browser egress proxy could not start.'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => {
          for (const socket of sockets) socket.destroy();
          if (!proxy.listening) return done();
          proxy.close(() => done());
        }),
      });
    });
  });
}

module.exports = { assertPublicHost, createEgressProxy, isPublicAddress, resolvePublicHost };
