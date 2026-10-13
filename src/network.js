import { networkInterfaces } from 'node:os';
export function lanAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter(a => a && !a.internal && a.family === 'IPv4' && /^192\.168\./.test(a.address)).map(a => a.address))].sort((a, b) => a.localeCompare(b));
}
