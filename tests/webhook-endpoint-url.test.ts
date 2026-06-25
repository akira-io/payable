import { describe, expect, it } from 'vitest';
import { WebhookEndpointUrl } from '../src/domain/value-objects/webhook-endpoint-url';

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
});
