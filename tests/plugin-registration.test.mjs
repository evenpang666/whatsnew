import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { registerWhatsnew, whatsnewInstalled } from '../scripts/register-plugin.mjs';
import { findDsh } from '../scripts/dsh-runtime.mjs';
import * as plugin from '../src/plugin.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'whatsnew-plugin-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'profiles/web');
  await mkdir(join(profile, 'node_modules'), { recursive: true });
  return { home, profile };
}

test('registration uses the official Web bundle installer and is idempotent', async t => {
  const { home, profile } = await fixture(t);
  const manifest = { dependencies: { existing: 'link:/existing' }, dsh: { profile: { bundles: ['existing'] } } };
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(profile, 'cordis.patch.yml'), '# preserved user configuration\n');
  let calls = 0;
  const options = { home, root, env: { CUSTOM: 'preserved' }, locate: async () => '/dsh/bin.js', log() {},
    async run(command, args, options) {
      calls++;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, ['/dsh/bin.js', 'plugin', '--profile', 'web', 'add', `link:${root.replaceAll('\\', '/').replace(/\/$/, '')}`]);
      assert.equal(options.env.DSH_HOME, home); assert.equal(options.env.CUSTOM, 'preserved');
      manifest.dependencies['dsh-whatsnew'] = `link:${root}`;
      manifest.dsh.profile.bundles.push('dsh-whatsnew');
      await writeFile(join(profile, 'package.json'), JSON.stringify(manifest));
      await symlink(root, join(profile, 'node_modules/dsh-whatsnew'), 'dir');
    } };
  await registerWhatsnew(options); await registerWhatsnew(options);
  assert.equal(calls, 1); assert.equal(await whatsnewInstalled(home, root), true);
  assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), '# preserved user configuration\n');
  assert.deepEqual(manifest.dsh.profile.bundles, ['existing', 'dsh-whatsnew']);
});

test('registration does not report success for a raw patch, stale link or incomplete install', async t => {
  const { home, profile } = await fixture(t);
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-whatsnew': 'link:/old' }, dsh: { profile: { bundles: ['dsh-whatsnew'] } } }));
  await symlink(home, join(profile, 'node_modules/dsh-whatsnew'), 'dir');
  assert.equal(await whatsnewInstalled(home, root), false);
  await assert.rejects(registerWhatsnew({ home, root, locate: async () => '/dsh/bin.js', run: async () => {}, log() {} }), /未完成/);
});

test('plugin logs successful loading, registers tools and releases its HTTP listener on dispose', async t => {
  const { home } = await fixture(t);
  const disposers = [], tools = [], logs = [];
  const original = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); original(...args); };
  t.after(async () => { console.log = original; for (const dispose of disposers) await dispose(); });
  const ctx = { agentDefaultModel: { currentSelection: () => ({ provider: 'host', model: 'default' }) },
    tools: { register: tool => tools.push(tool) }, on: (event, dispose) => { assert.equal(event, 'dispose'); disposers.push(dispose); } };
  await plugin.apply(ctx, { root: home, port: 0, host: '127.0.0.1' });
  console.log = original;
  const message = logs.join('\n');
  assert.match(message, /\[DSH 插件\] WhatsNew · GitHub 开源雷达 \(whatsnew\) · 已加载/);
  const url = message.match(/本机：(http:\/\/127\.0\.0\.1:\d+)/)[1];
  assert.equal((await fetch(url + '/api/state').then(r => r.json())).engine, 'DeepSeek Harness');
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['whatsnew_history', 'whatsnew_project', 'whatsnew_top']);
  await disposers.pop()();
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
});

// Exercise the host's actual plugin-library reader when DSH is installed.
// No DSH dependencies are needed to run the rest of this project's tests.
test('DSH plugin library resolves the installed bundle title, description, SVG and row', async t => {
  let require;
  try { require = createRequire(await findDsh()); require.resolve('@deepseek-ai/dsh-plugin-manager'); }
  catch { t.skip('DSH plugin manager is not installed'); return; }
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const { PluginManager } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager')).href);
  const { home, profile } = await fixture(t);
  await symlink(root, join(profile, 'node_modules/dsh-whatsnew'), 'dir');
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-whatsnew': `link:${root}` }, dsh: { profile: { bundles: ['dsh-whatsnew'] } } }));
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n');
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  ctx.provide('loader', { entries: () => [] });
  ctx.provide('profileContext', { name: 'web', dir: profile, installAnchor: require.resolve('@deepseek-ai/dsh/package.json'), startedBundles: [] });
  await ctx.plugin(PluginManager);
  const matches = (await ctx.pluginManager.listBundles()).filter(item => item.installed && item.name === 'dsh-whatsnew');
  assert.equal(matches.length, 1);
  const item = matches[0];
  assert.equal(item.enabled, true); assert.equal(item.removable, true); assert.equal(item.error, undefined);
  assert.equal(item.meta.title.zh, 'WhatsNew · GitHub 开源雷达');
  assert.match(item.meta.description.zh, /发现 GitHub Star 前 100/);
  assert.match(item.meta.icon, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(item.rows.map(row => row.rowId), ['whatsnew']);
});
