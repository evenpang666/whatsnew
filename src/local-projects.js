import { readdir, stat, readFile, mkdir, realpath, rename, writeFile, rm, open } from 'node:fs/promises';
import { join, basename, resolve, relative, sep, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
const execute = promisify(execFile);
export function githubIdentity(remote = '') {
  const match = remote.trim().match(/^(?:https:\/\/(?:[^/@]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}
// Parse only Git's numeric progress, never remote URLs or raw diagnostics.
export function parseGitProgress(line) {
  const match = line.match(/(Counting objects|Compressing objects|Receiving objects|Resolving deltas):\s+(\d+)%\s+\((\d+)\/(\d+)\)/);
  if (!match) return null;
  const phases = { 'Counting objects': '统计对象', 'Compressing objects': '压缩对象', 'Receiving objects': '接收对象', 'Resolving deltas': '整理对象' };
  return { phase: `${phases[match[1]]}…`, percent: Math.min(100, Number(match[2])), objects: Number(match[3]), objectTotal: Number(match[4]) };
}
export class LocalProjects {
  constructor(root, { runner = execute } = {}) {
    this.directory = join(root, 'downloads'); this.hooks = join(root, '.runtime', 'empty-git-hooks'); this.runner = runner;
    this.indexPath = join(this.directory, '.whatsnew-index.json');
  }
  async git(path, args, signal, onProgress) {
    await mkdir(this.hooks, { recursive: true });
    try {
      const pending = this.runner('git', ['-c', `core.hooksPath=${this.hooks}`, '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '-C', path, ...args], {
        signal, timeout: 180000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
      });
      if (onProgress && pending.child?.stderr) {
        let buffer = '';
        pending.child.stderr.on('data', data => {
          buffer += data.toString(); const lines = buffer.split(/[\r\n]/); buffer = lines.pop().slice(-2048);
          for (const line of lines) { const progress = parseGitProgress(line); if (progress) onProgress(progress); }
        });
      }
      const result = await pending;
      return result.stdout.trim();
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('未安装 Git，请安装后再克隆或拉取。');
      // Do not echo remote URLs or credentials from Git diagnostics.
      if (signal?.aborted) throw signal.reason;
      throw new Error(`Git 操作失败（${args[0]}）。请检查网络、分支和访问权限；本地文件未被强制覆盖。`);
    }
  }
  async safePath(path) {
    const real = await realpath(path), base = await realpath(this.directory);
    const rel = relative(base, real);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('项目必须位于默认下载目录内。');
    return real;
  }
  async scan(known = {}, repos = [], signal) {
    await mkdir(this.directory, { recursive: true });
    let index = {};
    try { index = JSON.parse(await readFile(this.indexPath, 'utf8')); } catch {}
    const downloads = {}, projectRepos = [], warnings = []; let directories = 0;
    const entries = await readdir(this.directory, { withFileTypes: true });
    const files = new Set(entries.filter(e => e.isFile() && e.name.endsWith('.zip')).map(e => e.name));
    for (const [id, value] of Object.entries({ ...index, ...known })) {
      const zip = value.zip || (value.filename ? value : null);
      if (!zip || basename(zip.filename || '') !== zip.filename || !files.has(zip.filename)) continue;
      const info = await stat(join(this.directory, zip.filename));
      if (info.size) downloads[id] = { ...zip, zip: { ...zip, size: info.size }, repo: value.repo || zip.repo };
    }
    // Recover app-named archives even when the runtime cache was removed.
    for (const name of files) {
      const match = name.match(/^([\w.-]+)--([\w.-]+)-(commit|release)_(.+)\.zip$/);
      if (!match) continue;
      const id = `${match[1]}/${match[2]}`;
      if (downloads[id]) continue;
      const info = await stat(join(this.directory, name)); if (!info.size) continue;
      const repo = repos.find(r => r.id.toLowerCase() === id.toLowerCase()) || { id, name: match[2], owner: match[1], url: `https://github.com/${id}`, branch: 'main', stars: null, topics: [], analyzed: false };
      const zip = { filename: name, size: info.size, version: match[3] === 'commit' ? `commit:${match[4]}` : null, versionLabel: match[4], downloadedAt: info.mtime.toISOString() };
      downloads[repo.id] = { ...zip, zip, repo };
    }
    for (const name of files) {
      if (Object.values(downloads).some(d => d.zip?.filename === name)) continue;
      const path = join(this.directory,name), info = await stat(path); if (!info.size) continue;
      const id = `local:${createHash('sha256').update(path).digest('hex').slice(0,16)}`;
      const repo = { id, name, owner:'本地文件', topics:[], analyzed:false, localOnly:true, localKind:'archive', localPath:path, stars:null };
      downloads[id] = { zip:{filename:name,size:info.size,downloadedAt:info.mtime.toISOString()},repo }; projectRepos.push(repo);
    }
    const walk = async (directory, depth) => {
      signal?.throwIfAborted();
      if (++directories > 2000) { if (!warnings.length) warnings.push('目录过多，扫描上限为 2000 个目录。'); return; }
      const children = await readdir(directory, { withFileTypes: true });
      if (children.some(e => e.name === '.git' && (e.isDirectory() || e.isFile()))) {
        try {
          const path = await this.safePath(directory);
          if (resolve(await this.git(path, ['rev-parse', '--show-toplevel'], signal)) !== path) throw new Error('无效的 Git 工作目录。');
          const [remote, head, branch] = await Promise.all([
            this.git(path, ['remote', 'get-url', 'origin'], signal).catch(() => ''),
            this.git(path, ['rev-parse', 'HEAD'], signal).catch(() => ''),
            this.git(path, ['symbolic-ref', '--short', 'HEAD'], signal).catch(() => '')
          ]);
          const identity = githubIdentity(remote);
          const id = repos.find(r => r.id.toLowerCase() === identity?.toLowerCase())?.id || identity || `local:${createHash('sha256').update(path).digest('hex').slice(0, 16)}`;
          const git = { path, head, branch, version: head ? `commit:${head}` : null, versionLabel: head.slice(0, 7) || '尚无提交', checkedAt: null };
          const localOnly = !identity;
          const repo = { id, name: identity?.split('/')[1] || basename(path), owner: identity?.split('/')[0] || '本地项目', url: identity ? `https://github.com/${identity}` : null, branch: branch || 'main', stars: null, forks: null, topics: [], description: '', analyzed: false, localOnly, localKind:'git', localPath: path };
          const saved = downloads[id];
          downloads[id] = { ...saved, git: saved?.git || git, gitCopies: [...(saved?.gitCopies || []), git], repo: saved?.repo || repo };
          projectRepos.push(repo);
        } catch (error) { warnings.push(`${basename(directory)}：${error.message}`); }
        return;
      }
      const isProject = children.some(e => e.isFile() && (/^(readme(?:\.[\w]+)?|package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|CMakeLists\.txt)$/i.test(e.name) || /\.(?:py|js|ts|mjs|rs|go|java|cpp|c|html|ipynb)$/i.test(e.name)));
      if (isProject) {
        const path = await this.safePath(directory), id = `local:${createHash('sha256').update(path).digest('hex').slice(0,16)}`;
        const repo = { id, name:basename(path), owner:'本地项目', topics:[], analyzed:false, localOnly:true, localKind:'folder', localPath:path, stars:null };
        downloads[id] = {folder:{path},repo}; projectRepos.push(repo); return;
      }
      if (depth >= 5) { if (children.some(e => e.isDirectory())) warnings.push(`扫描深度限制：${relative(this.directory, directory)}`); return; }
      for (const entry of children) if (entry.isDirectory() && !entry.name.startsWith('.clone-') && !['.git', '.runtime', '.cache', '.venv', 'node_modules', 'vendor', 'target', 'dist'].includes(entry.name)) await walk(join(directory, entry.name), depth + 1);
    };
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.clone-') && !['.git', '.runtime', '.cache', '.venv', 'node_modules', 'vendor', 'target', 'dist'].includes(entry.name)) await walk(join(this.directory, entry.name), 0);
    return { downloads, repos: projectRepos, warnings };
  }
  async saveIndex(downloads) {
    await mkdir(this.directory, { recursive: true });
    const records = Object.fromEntries(Object.entries(downloads).filter(([, d]) => d.zip).map(([id, d]) => [id, { zip: d.zip, repo: d.repo }]));
    const tmp = `${this.indexPath}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(records), { mode: 0o600 }); await rename(tmp, this.indexPath);
  }
  async content(path) {
    path = await this.safePath(path); const sections = [];
    const names = ['README.md', 'readme.md', 'README.rst', 'README', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
    for (const name of names) {
      let handle;
      try {
        const target = join(path, name); const real = await realpath(target);
        if (relative(path, real).startsWith('..') || isAbsolute(relative(path, real))) continue;
        handle = await open(real, 'r'); if (!(await handle.stat()).isFile()) continue;
        const buffer = Buffer.alloc(12000); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        sections.push(`文件 ${name}\n${buffer.subarray(0, bytesRead).toString('utf8')}`);
      } catch {} finally { await handle?.close(); }
      if (sections.join('\n').length > 16000) break;
    }
    return { text: sections.join('\n\n').slice(0, 18000), source: '默认目录中的本地 README 与项目清单' };
  }
  async clone(id, signal, onProgress) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(id)) throw new Error('GitHub 项目标识无效。');
    await mkdir(this.directory, { recursive: true });
    const destination = join(this.directory, id.replace('/', '--'));
    try { await stat(destination); throw new Error('目标目录已存在，请先检查已有项目。'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const temp = join(this.directory, `.clone-${randomUUID()}`);
    try {
      await this.git(this.directory, ['clone', '--progress', '--', `https://github.com/${id}.git`, temp], signal, onProgress);
      onProgress?.({ phase: '保存克隆项目…', percent: null });
      signal?.throwIfAborted(); await rename(temp, destination); return { path: destination };
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  async assertRemote(git, id, signal) {
    const path = await this.safePath(git.path);
    if (githubIdentity(await this.git(path, ['remote', 'get-url', 'origin'], signal))?.toLowerCase() !== id.toLowerCase()) throw new Error('项目 origin 已改变，请重新扫描。');
    const branch = await this.git(path, ['symbolic-ref', '--short', 'HEAD'], signal).catch(() => '');
    if (!branch || !/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new Error('请先切换到有效的本地分支再检查或拉取。');
    return { path, branch };
  }
  async check(git, id, signal) {
    const { path, branch } = await this.assertRemote(git, id, signal);
    // Fetch the corresponding public GitHub branch, never a non-GitHub origin.
    await this.git(path, ['fetch', '--no-tags', '--no-recurse-submodules', `https://github.com/${id}.git`, `refs/heads/${branch}`], signal);
    const counts = await this.git(path, ['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'], signal);
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) throw new Error('无法确定分支更新状态。');
    return { ...git, branch, ahead, behind, checkedAt: new Date().toISOString(), remoteHead: await this.git(path, ['rev-parse', 'FETCH_HEAD'], signal) };
  }
  async pull(git, id, signal, onProgress) {
    const { path, branch } = await this.assertRemote(git, id, signal);
    if (await this.git(path, ['status', '--porcelain'], signal)) throw new Error('存在本地修改或未跟踪文件，请先提交或移走它们，再拉取。');
    await this.git(path, ['pull', '--progress', '--ff-only', '--no-recurse-submodules', `https://github.com/${id}.git`, branch], signal, onProgress);
    onProgress?.({ phase: '校验更新后的项目…', percent: null });
    return { path, head: await this.git(path, ['rev-parse', 'HEAD'], signal) };
  }
}
