#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function run(command, argv, env = process.env) {
  return new Promise((done, reject) => {
    const child = spawn(command, argv, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const cleanup = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); done(code ?? 1); });
  });
}

try {
  let bootstrap = Number(process.versions.node.split('.')[0]) < 22;
  let runtimeModule;
  if (!bootstrap) {
    runtimeModule = await import('./dsh-runtime.mjs');
    try {
      const npm = await runtimeModule.findNpm();
      await runtimeModule.versionOf(npm);
    } catch { bootstrap = true; }
  }
  if (bootstrap) {
    if (process.env.WHATSNEW_BOOTSTRAPPED) throw new Error('项目内 Node.js/npm 无法运行，请检查 .runtime/node 或重新安装。');
    const windows = process.platform === 'win32';
    process.exitCode = await run(windows ? 'powershell.exe' : 'sh', windows
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./bootstrap-node.ps1', import.meta.url))]
      : [fileURLToPath(new URL('../start.sh', import.meta.url)), ...args],
    { ...process.env, WHATSNEW_BOOTSTRAP_ARGS: JSON.stringify(args) });
  } else if (args[0] === '--check') {
    await runtimeModule.ensureEnvironment();
    console.log('[环境] 检查完成。');
  } else if (args[0] === '--dsh' || args[0] === '--register') {
    const runtime = await runtimeModule.ensureEnvironment();
    if (args[0] === '--register') {
      const { registerWhatsnew } = await import('./register-plugin.mjs');
      await registerWhatsnew({ env: runtime.env, locate: async () => runtime.dsh });
    } else process.exitCode = await run(process.execPath, [runtime.dsh, ...args.slice(1)], runtime.env);
  } else await import('./launch.mjs');
} catch (error) { console.error(error.message); process.exitCode = 1; }
