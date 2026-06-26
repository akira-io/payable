export function isBlockedHostname(hostname: string): boolean {
  const host = normalize(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  return isBlockedIp(host);
}

export function isBlockedIp(address: string): boolean {
  const host = normalize(address);
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    return isBlockedIpv4(ipv4);
  }
  return isBlockedIpv6(host);
}

function normalize(value: string): string {
  return value.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets as [number, number, number, number];
}

function isBlockedIpv4([first, second]: [number, number, number, number]): boolean {
  if (first === 10 || first === 127 || first === 0) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  return first === 100 && second >= 64 && second <= 127;
}

function isBlockedIpv6(host: string): boolean {
  if (host === '::1' || host === '::') {
    return true;
  }
  const embedded = embeddedIpv4(host);
  if (embedded) {
    return isBlockedIpv4(embedded);
  }
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(host);
}

function embeddedIpv4(host: string): [number, number, number, number] | null {
  const dotted = host.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1]) {
    return parseIpv4(dotted[1]);
  }
  const hex = host.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex?.[1] && hex[2]) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
  }
  return null;
}
