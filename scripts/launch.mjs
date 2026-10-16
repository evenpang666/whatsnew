#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureEnvironment } from './dsh-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.WHATSNEW_PORT || 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('WHATSNEW_PORT 必须是 1024–65535 的端口号。');
const url = `http://127.0.0.1:${port}`;
const runtime = await ensureEnvironment();
function openBrowser() {
  if (process.env.WHATSNEW_NO_OPEN) return;
  const command = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`请在浏览器打开 ${url}`)); child.unref();
}
async function isReady() {
  try { const response = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(800) }); const value = await response.json(); return response.ok && value.engine === 'DeepSeek Harness'; }
  catch { return false; }
}
if (await isReady()) { openBrowser(); console.log(`已打开运行中的 WhatsNew：${url}`); process.exit(0); }

const dshBin = runtime.dsh;
const originalHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'));
const localHome = join(root, '.runtime', 'dsh');
const profile = join(localHome, 'profiles', 'whatsnew');
await mkdir(profile, { recursive: true });
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup' } } }, null, 2));
// Reuse the existing DSH model configuration by path; never copy API keys.
const patch = [
  { id: 'settings', config: { path: join(originalHome, 'settings.yaml'), watch: false } },
  { id: 'credentials', config: { path: join(originalHome, '.credentials.yaml'), watch: false } },
  { id: 'session-title-llm', disabled: true },
  { id: 'tools', config: { mode: 'native' } },
  { insert: [{ id: 'whatsnew', name: join(root, 'src', 'plugin.js'), config: { root, port } }] }
];
const patchPath = join(profile, 'cordis.patch.yml');
await writeFile(patchPath, JSON.stringify(patch, null, 2));
console.log('正在启动 DeepSeek Harness · WhatsNew…');
const child = spawn(process.execPath, [dshBin, '--profile', 'whatsnew'], { cwd: root, stdio: 'inherit', env: { ...runtime.env, DSH_HOME: localHome, DSH_TELEMETRY_DISABLED: '1' } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
const timeout = setTimeout(() => console.log('启动仍在进行，请留意终端提示。'), 15000);
const poll = setInterval(async () => { if (await isReady()) { clearInterval(poll); clearTimeout(timeout); openBrowser(); } }, 700);
child.on('exit', code => { clearInterval(poll); clearTimeout(timeout); process.exitCode = code ?? 1; });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
