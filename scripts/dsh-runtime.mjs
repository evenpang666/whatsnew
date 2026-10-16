import { access, realpath } from 'node:fs/promises';
import { dirname, join, delimiter } from 'node:path';

// Resolve npm's Windows shim to JavaScript so no shell interpolation is needed.
export async function findDsh(env = process.env) {
  const candidates = env.DSH_BIN ? [env.DSH_BIN] : (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
    .flatMap(directory => (process.platform === 'win32' ? ['dsh.cmd', 'dsh'] : ['dsh']).map(name => join(directory, name)));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const path = await realpath(candidate);
      if (!/\.cmd$/i.test(path)) return path;
      const entry = join(dirname(path), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      await access(entry); return entry;
    } catch {}
  }
  throw new Error('未找到 dsh。请先安装 Node.js 22+，然后运行 npm install -g @deepseek-ai/dsh，并在 dsh web 中配置模型。');
}
