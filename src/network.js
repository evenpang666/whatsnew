import { networkInterfaces } from 'node:os';

function isEthernet(name) {
  if (/virtual|vmware|vmnet|vbox|vethernet|hyper-v|wsl|vpn|tap|tun|虚拟/i.test(name)) return false;
  return /^(?:以太网|ethernet)(?:\s*\d+)?$/i.test(name)
    || /^(?:eth\d+|en\d+|en[opsx][a-z0-9]+)$/i.test(name);
}

export function lanAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.entries(interfaces)
    .filter(([name]) => isEthernet(name))
    .flatMap(([, addresses]) => addresses || [])
    .filter(a => a && !a.internal && a.family === 'IPv4' && /^192\.168\./.test(a.address))
    .map(a => a.address))].sort((a, b) => a.localeCompare(b));
}
