const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'server.js', 'browser.js', 'network-proxy.js', 'market-data.js',
  'public/app.js', 'public/browser-view.js',
];

test('all JavaScript entry points parse successfully', () => {
  for (const relativePath of sourceFiles) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, relativePath)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relativePath}: ${result.stderr || result.stdout}`);
  }
});

test('the browser UI is served from the expected public entry point', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /<title>[^<]*XK-TRADE-BOT/i);
  assert.match(html, /src="\/app\.js"/);
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /id="browser-frame"/);
  assert.match(html, /id="ticker-analyzer"/);
  assert.match(html, /id="model-select"/);
  assert.match(html, /id="conversation-history"/);
  assert.match(html, /id="mobile-history-open"/);
});

test('assistant content is rendered as text rather than executable HTML', () => {
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.doesNotMatch(app, /\beval\s*\(/);
  assert.match(app, /textContent\s*=/);
  assert.match(app, /CONVERSATION_STORAGE_KEY/);
  assert.match(app, /Delete this conversation/);
  assert.match(app, /image data URLs are intentionally never persisted/);
});

test('deployment configuration keeps browser automation in the server container', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deploy = fs.readFileSync(path.join(root, 'DEPLOY.md'), 'utf8');
  assert.match(dockerfile, /apt-get install[^\n]*chromium|apt-get install -y[\s\\\n]*--no-install-recommends chromium/s);
  assert.equal(packageJson.dependencies['playwright-core'], '1.64.1');
  assert.match(deploy, /TOKEN_HARBOR_API_KEY/);
  assert.match(deploy, /\/health/);
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /market_snapshot/);
  assert.match(server, /loadLocalEnvFile/);
  assert.match(server, /deepseek-v4\.1-flash:free/);
  assert.match(server, /mimo-v2\.6-flash:free/);
});
