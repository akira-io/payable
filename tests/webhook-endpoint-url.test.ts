import { describe, expect, it } from 'vitest';
import { WebhookEndpointUrl } from '../src/domain/value-objects/webhook-endpoint-url';
import { isBlockedIp } from '../src/support/net/blocked-host';

describe('WebhookEndpointUrl', () => {
  it('accepts a public https url', () => {
    expect(WebhookEndpointUrl.parse('https://hooks.example.com/payable').toString()).toBe(
      'https://hooks.example.com/payable',
    );
  });

  it('rejects non-https urls', () => {
    expect(() => WebhookEndpointUrl.parse('http://hooks.example.com')).toThrow('must use https');
  });

  it('rejects loopback, link-local, private, and metadata hosts', () => {
    for (const url of [
      'https://localhost/hook',
      'https://app.localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.1.2.3/hook',
      'https://192.168.0.1/hook',
      'https://172.16.5.4/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/hook',
    ]) {
      expect(() => WebhookEndpointUrl.parse(url)).toThrow('non-routable host');
    }
  });

  it('rejects IPv4-mapped and NAT64 IPv6 that target blocked IPv4 ranges', () => {
    for (const url of [
      'https://[::ffff:127.0.0.1]/hook',
      'https://[::ffff:169.254.169.254]/latest/meta-data',
      'https://[::ffff:10.0.0.1]/hook',
      'https://[::ffff:192.168.1.1]/hook',
      'https://[64:ff9b::7f00:1]/hook',
    ]) {
      expect(() => WebhookEndpointUrl.parse(url)).toThrow('non-routable host');
    }
  });

  it('still accepts an IPv4-mapped public address', () => {
    expect(() => WebhookEndpointUrl.parse('https://[::ffff:8.8.8.8]/hook')).not.toThrow();
  });

  it('rejects multicast, reserved, and documentation/test-net ranges', () => {
    for (const url of [
      'https://224.0.0.1/hook',
      'https://239.255.255.250/hook',
      'https://240.0.0.1/hook',
      'https://192.0.2.10/hook',
      'https://198.51.100.10/hook',
      'https://203.0.113.10/hook',
      'https://198.18.0.10/hook',
    ]) {
      expect(() => WebhookEndpointUrl.parse(url)).toThrow('non-routable host');
    }
  });
});

describe('isBlockedIp (raw, non-canonical forms)', () => {
  it('blocks numeric, octal, and hex IPv4 encodings of loopback', () => {
    expect(isBlockedIp('2130706433')).toBe(true);
    expect(isBlockedIp('0177.0.0.1')).toBe(true);
    expect(isBlockedIp('0x7f.0.0.1')).toBe(true);
  });

  it('blocks IPv6 loopback with a zone id and the uncompressed form', () => {
    expect(isBlockedIp('::1%eth0')).toBe(true);
    expect(isBlockedIp('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('does not block a public address', () => {
    expect(isBlockedIp('93.184.216.34')).toBe(false);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });
});
