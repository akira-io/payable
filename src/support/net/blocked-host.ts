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

function parseUint(part: string): number | null {
  if (/^0x[0-9a-f]+$/.test(part)) {
    return Number.parseInt(part.slice(2), 16);
  }
  if (/^0[0-7]+$/.test(part)) {
    return Number.parseInt(part.slice(1), 8);
  }
  if (/^\d+$/.test(part)) {
    return Number.parseInt(part, 10);
  }
  return null;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  if (host.includes('.')) {
    const parts = host.split('.');
    if (parts.length !== 4) {
      return null;
    }
    const octets = parts.map(parseUint);
    if (octets.some((octet) => octet === null || octet < 0 || octet > 255)) {
      return null;
    }
    return octets as [number, number, number, number];
  }
  const value = parseUint(host);
  if (value === null || value < 0 || value > 0xff_ff_ff_ff) {
    return null;
  }
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function isBlockedIpv4([first, second, third]: [number, number, number, number]): boolean {
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first >= 224) {
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
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }
  return isReservedDocumentationIpv4(first, second, third);
}

function isReservedDocumentationIpv4(first: number, second: number, third: number): boolean {
  if (first === 192 && second === 0 && (third === 0 || third === 2)) {
    return true;
  }
  if (first === 198 && second === 51 && third === 100) {
    return true;
  }
  return first === 203 && second === 0 && third === 113;
}

function isBlockedIpv6(host: string): boolean {
  const zoneless = host.split('%')[0] ?? host;
  if (zoneless === '::1' || zoneless === '::' || /^(0:){7}0*1$/.test(zoneless)) {
    return true;
  }
  const embedded = embeddedIpv4(zoneless);
  if (embedded) {
    return isBlockedIpv4(embedded);
  }
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(zoneless);
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
