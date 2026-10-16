import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { ensureEnvironment, findDsh, installTool, versionOf, versions } from '../scripts/dsh-runtime.mjs';

const execute = promisify(execFile);
const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'whatsnew-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { PATH: join(root, 'empty'), DSH_HOME: join(root, 'home') };
  return { root, env };
}

test('installed tools are reused even when older than the fallback; no installs or update queries', async t => {
  const { root, env } = await fixture(t);
  const pnpm = join(root, `.runtime/tools/pnpm-${versions.pnpm}/node_modules/pnpm/bin/pnpm.cjs`);
  const calls = [];
  const runtime = await ensureEnvironment({ root, env, log() {}, locateNpm: async () => '/npm', locateDsh: async () => '/existing-dsh',
    inspect: async cli => { calls.push(cli); return cli === '/npm' ? '10.0.0' : cli === pnpm ? '10.1.0' : '0.1.5-rc.2'; },
    install: async () => assert.fail('existing tools must not be upgraded') });
  assert.equal(runtime.dsh, '/existing-dsh'); assert.equal(runtime.pnpm, pnpm);
  assert.deepEqual(calls, ['/npm', '/existing-dsh', pnpm]);
  assert.equal(env.PATH, join(root, 'empty'), 'the parent environment is unchanged');
  assert.equal(runtime.env.PATH.split(delimiter)[0], resolve(dirname(pnpm), '../../.bin'));
});

test('missing DSH and pnpm are installed once at fixed project-local versions', async t => {
  const { root, env } = await fixture(t);
  const installed = new Map(), calls = [];
  const options = { root, env, log() {}, locateNpm: async () => '/npm',
    locateDsh: async () => installed.has('@deepseek-ai/dsh') ? installed.get('@deepseek-ai/dsh').cli : null,
    inspect: async cli => {
      if (cli === '/npm') return '10.9.9';
      const entry = [...installed.values()].find(item => item.cli === cli);
      if (!entry) throw missing();
      return entry.version;
    },
    install: async entry => {
      calls.push(entry);
      installed.set(entry.name, { cli: join(entry.directory, 'node_modules', entry.entry), version: entry.version });
    } };
  await ensureEnvironment(options); await ensureEnvironment(options);
  assert.deepEqual(calls.map(item => [item.name, item.version]), [['@deepseek-ai/dsh', versions.dsh], ['pnpm', versions.pnpm]]);
  for (const entry of calls) assert.ok(entry.directory.startsWith(join(root, '.runtime/tools')));
});

test('pnpm matches the existing profile without changing its store or installed DSH', async t => {
  const { root, env } = await fixture(t);
  const modules = join(env.DSH_HOME, 'profiles/web/node_modules'); await mkdir(modules, { recursive: true });
  await writeFile(join(modules, '.modules.yaml'), 'packageManager: pnpm@10.5.2\nstoreDir: /existing/pnpm/store/v10\n');
  const calls = [];
  const pnpmPath = join(root, '.runtime/tools/pnpm-10.5.2/node_modules/pnpm/bin/pnpm.cjs');
  let installed = false;
  const runtime = await ensureEnvironment({ root, env, log() {}, locateNpm: async () => '/npm', locateDsh: async () => '/dsh',
    inspect: async cli => { if (cli === pnpmPath && !installed) throw missing(); return cli === pnpmPath ? '10.5.2' : cli === '/dsh' ? '0.1.5-rc.2' : '10.9.9'; },
    install: async entry => { calls.push(entry); installed = true; } });
  assert.deepEqual(calls.map(item => [item.name, item.version]), [['pnpm', '10.5.2']]);
  assert.equal(runtime.env.npm_config_store_dir, '/existing/pnpm/store');
  assert.equal(runtime.env.PNPM_CONFIG_STORE_DIR, '/existing/pnpm/store');
  assert.equal(await readFile(join(modules, '.modules.yaml'), 'utf8'), 'packageManager: pnpm@10.5.2\nstoreDir: /existing/pnpm/store/v10\n');
});

test('invalid explicit DSH and broken installed DSH fail without silently installing a replacement', async t => {
  const { root, env } = await fixture(t);
  await assert.rejects(findDsh({ ...env, DSH_BIN: join(root, 'does-not-exist') }, root), /DSH_BIN/);
  await assert.rejects(ensureEnvironment({ root, env, log() {}, locateNpm: async () => '/npm', locateDsh: async () => '/broken',
    inspect: async cli => { if (cli === '/broken') throw new Error('broken DSH'); return '10.9.9'; },
    install: async () => assert.fail('must not replace an existing DSH') }), /broken DSH/);
});

test('tool installation publishes a verified fixed version and removes partial downloads on failure', async t => {
  const { root, env } = await fixture(t);
  const directory = join(root, 'tools/pnpm'); let calls = 0;
  const options = { name: 'pnpm', version: versions.pnpm, entry: 'pnpm/bin/pnpm.cjs', directory, npm: '/npm-cli.js', env,
    async run(command, args, settings) {
      calls++;
      assert.equal(command, process.execPath);
      assert.equal(args.at(-1), `pnpm@${versions.pnpm}`);
      assert.ok(args.includes('--no-save')); assert.ok(args.includes('--no-package-lock'));
      const file = join(settings.cwd, 'node_modules/pnpm/bin/pnpm.cjs');
      await mkdir(dirname(file), { recursive: true }); await writeFile(file, 'verified');
    }, versionOf: async () => versions.pnpm };
  await installTool(options);
  assert.equal(await readFile(join(directory, 'node_modules/pnpm/bin/pnpm.cjs'), 'utf8'), 'verified');
  await assert.rejects(installTool({ ...options, directory: join(root, 'tools/failed'), run: async () => { throw new Error('offline'); } }), /offline/);
  assert.deepEqual(await readdir(join(root, 'tools')), ['pnpm']); assert.equal(calls, 1);
});

test('version probes handle JavaScript CLIs and native pnpm executables', async t => {
  if (process.platform === 'win32') { t.skip('Unix native fixture'); return; }
  const { root, env } = await fixture(t);
  const js = join(root, 'npm-cli.js'), native = join(root, 'pnpm');
  await writeFile(js, 'console.log("10.9.9")');
  await writeFile(native, '#!/bin/sh\nprintf "12.3.4\\n"\n', { mode: 0o755 });
  assert.equal(await versionOf(js, env), '10.9.9'); assert.equal(await versionOf(native, env), '12.3.4');
});

test('Unix Node bootstrap installs verified archives, reuses local Node offline, and rejects bad checksums', async t => {
  if (process.platform === 'win32') { t.skip('Unix bootstrap'); return; }
  const { root } = await fixture(t);
  const fixtureRoot = join(root, 'fixture'), scripts = join(fixtureRoot, 'scripts');
  await mkdir(scripts, { recursive: true });
  await writeFile(join(scripts, 'runtime-versions.json'), JSON.stringify(versions, null, 2));
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const archiveName = `node-v${versions.node}-${platform}-${process.arch}`;
  const unpacked = join(root, 'package', archiveName);
  await mkdir(join(unpacked, 'bin'), { recursive: true });
  await mkdir(join(unpacked, 'lib/node_modules/npm/bin'), { recursive: true });
  await writeFile(join(unpacked, 'bin/node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(join(unpacked, 'lib/node_modules/npm/bin/npm-cli.js'), '');
  const archive = join(root, `${archiveName}.tar.gz`);
  await execute('tar', ['-czf', archive, '-C', dirname(unpacked), archiveName]);
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
  const sums = join(root, 'SHASUMS256.txt'); await writeFile(sums, `${hash}  ${archiveName}.tar.gz\n`);
  const bootstrap = new URL('../scripts/bootstrap-node.sh', import.meta.url).pathname;
  const shell = join(root, 'test-bootstrap.sh');
  // Pass paths through positional arguments rather than embedding shell text.
  await writeFile(shell, `set -eu
WHATSNEW_ROOT="$1"; sums="$3"; archive="$4"
. "$2"
whatsnew_download() {
  case "$1" in */SHASUMS256.txt) cp "$sums" "$2" ;; *) cp "$archive" "$2" ;; esac
}
whatsnew_install_node
whatsnew_download() { echo 'unexpected network request' >&2; return 1; }
whatsnew_node_ok() { [ "$1" = "$WHATSNEW_ROOT/.runtime/node/current/bin/node" ]; }
whatsnew_prepare_node
test "$WHATSNEW_NODE" = "$WHATSNEW_ROOT/.runtime/node/current/bin/node"
`);
  await execute('sh', [shell, fixtureRoot, bootstrap, sums, archive]);
  await access(join(fixtureRoot, '.runtime/node/current/bin/node'));
  await writeFile(sums, `${'0'.repeat(64)}  ${archiveName}.tar.gz\n`);
  const badRoot = join(root, 'bad'); await mkdir(join(badRoot, 'scripts'), { recursive: true });
  await writeFile(join(badRoot, 'scripts/runtime-versions.json'), JSON.stringify(versions, null, 2));
  await assert.rejects(execute('sh', [shell, badRoot, bootstrap, sums, archive]), /checksum mismatch/);
  assert.deepEqual(await readdir(join(badRoot, '.runtime/node')), []);
});
