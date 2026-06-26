import { describe, expect, it } from 'vitest';
import { isLoopbackHost, parseHost, parsePort } from '../src/presentation/mcp/cli-args';

describe('parseHost', () => {
  it('parses an IPv4 host and port', () => {
    expect(parseHost('0.0.0.0:8080')).toEqual({ host: '0.0.0.0', port: 8080 });
  });

  it('parses a bare host with no port', () => {
    expect(parseHost('localhost')).toEqual({ host: 'localhost', port: undefined });
  });

  it('parses a bracketed IPv6 host with a port', () => {
    expect(parseHost('[::1]:3333')).toEqual({ host: '::1', port: 3333 });
  });

  it('parses a bracketed IPv6 host without a port', () => {
    expect(parseHost('[::]')).toEqual({ host: '::', port: undefined });
  });

  it('treats a bare IPv6 literal as a host with no port', () => {
    expect(parseHost('::1')).toEqual({ host: '::1', port: undefined });
  });

  it('returns nothing for a non-string flag', () => {
    expect(parseHost(true)).toEqual({});
  });
});

describe('parsePort', () => {
  it('parses a valid port', () => {
    expect(parsePort('8080')).toBe(8080);
  });

  it('rejects a non-numeric or out-of-range port', () => {
    expect(() => parsePort('abc')).toThrow(/Invalid --http port/);
    expect(() => parsePort('0')).toThrow(/Invalid --http port/);
    expect(() => parsePort('70000')).toThrow(/Invalid --http port/);
  });
});

describe('isLoopbackHost', () => {
  it('recognizes loopback addresses and an unset host', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });
});
