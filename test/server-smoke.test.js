const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 31000 + (process.pid % 20000);
const baseUrl = `http://127.0.0.1:${port}`;
let server;

async function waitForServer(child) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(300) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become healthy within six seconds.');
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CHROMIUM_PATH: '/missing/chromium', TOKEN_HARBOR_API_KEY: '' },
    stdio: 'ignore',
  });
  await waitForServer(server);
});

test.after(async () => {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
});

test('health route responds with HTTP 200', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
});

test('status exposes only the allowlisted free model choices', async () => {
  const response = await fetch(`${baseUrl}/api/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.configured, false);
  assert.ok(status.models.some((item) => item.id === 'claude-haiku-5.5:free'));
  assert.equal(status.model, 'claude-haiku-5.5:free');
  assert.ok(status.models.some((item) => item.id === 'deepseek-v4.1-flash:free'));
  assert.ok(status.models.some((item) => item.id === 'deepseek-v4-flash:free'));
  assert.ok(status.models.some((item) => item.id === 'mimo-v2.6-flash:free'));
});

test('static app loads with same-origin and frame protections', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(await response.text(), /XK-TRADE-BOT/);
});

test('cross-origin JSON mutations with a different host or protocol are rejected', async () => {
  for (const origin of ['https://attacker.example', `https://${new URL(baseUrl).host}`]) {
    const response = await fetch(`${baseUrl}/api/browser/reset`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '12345678901234567890123456789012' }),
    });
    assert.equal(response.status, 403, `Origin ${origin} should be rejected`);
    assert.match((await response.json()).error, /Cross-origin/);
  }
});

test('demo chat responds without exposing provider credentials', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      browserSessionId: '12345678901234567890123456789012',
      messages: [{ role: 'user', content: 'Explain valuation' }],
    }),
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /event: token/);
  assert.match(stream, /Demo mode is active/);
  assert.match(stream, /event: done/);
});

test('non-JSON API mutations are rejected', async () => {
  const response = await fetch(`${baseUrl}/api/browser/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'nope',
  });
  assert.equal(response.status, 415);
});
