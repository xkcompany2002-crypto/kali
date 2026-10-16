const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublicAddress } = require('../network-proxy');

test('accepts representative public IPv4 and IPv6 destinations', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
});

test('rejects loopback, private, link-local, and reserved IPv4 ranges', () => {
  for (const address of [
    '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.254',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.4',
    '198.51.100.20', '203.0.113.10', '0.0.0.0', '224.0.0.1',
  ]) assert.equal(isPublicAddress(address), false, `${address} should be blocked`);
});

test('rejects loopback, unique-local, link-local, documentation, and mapped-private IPv6', () => {
  for (const address of [
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '2001:db8::1', '2002::1', '::ffff:192.168.1.1',
  ]) assert.equal(isPublicAddress(address), false, `${address} should be blocked`);
});

test('rejects malformed address input', () => {
  for (const address of ['', 'localhost', '999.999.999.999', 'not-an-ip']) {
    assert.equal(isPublicAddress(address), false, `${address} should be blocked`);
  }
});
