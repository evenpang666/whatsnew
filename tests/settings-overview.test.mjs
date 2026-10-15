import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhatsNewService } from '../src/service.js';
import { DeepSeekToken } from '../src/deepseek-token.js';
import { independentModel } from '../src/deepseek-model.js';
import { startServer } from '../src/server.js';
import { calculateOverview, windowDates } from '../src/ranking.js';

const repo = { id:'test/repo', name:'repo', stars:500, analyzed:true, analysisVersion:2 };
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'whatsnew-settings-'));
  const service = new WhatsNewService({ root, ...options }); await service.init();
  service.deepseekCredentials = new DeepSeekToken(root, null);
  t.after(async () => { await service.close(); await rm(root, { recursive:true, force:true }); });
  return service;
}
function lifecycle(now = new Date(), count = 2) {
  const to = now.toISOString().slice(0,10), start = Date.parse(to) - 40 * 86400000;
  return { metric:'daily-new-stars', createdAt:new Date(start).toISOString(), to, fetchedAt:now.toISOString(),
    points:Array.from({length:41}, (_,i) => ({date:new Date(start+i*86400000).toISOString().slice(0,10), stars:count})) };
}

test('independent DeepSeek token persists, overrides fallback, and never exposes values in status', async t => {
  const service = await fixture(t), credentials = new DeepSeekToken(service.root, 'fallback');
  assert.equal(await credentials.get(), 'fallback');
  await credentials.save('sk_test_private');
  const restored = new DeepSeekToken(service.root, 'fallback');
  assert.equal(await restored.get(), 'sk_test_private');
  assert.deepEqual(await restored.status(), {enabled:true, source:'config/deepseek.token', path:'config/deepseek.token'});
  await assert.rejects(restored.save('sk_bad\nvalue'), /格式/);
  assert.equal(await restored.get(), 'sk_test_private');
  await restored.remove(); assert.equal(await restored.get(), 'fallback');
  assert.equal((await restored.status()).source, 'DEEPSEEK_API_KEY');
});

test('DeepSeek HTTP settings enforce CSRF, preserve existing token on invalid input, and omit secrets', async t => {
  const service = await fixture(t), runtime = await startServer(service, {port:0, host:'127.0.0.1'});
  t.after(() => runtime.close());
  const state = await (await fetch(runtime.url+'/api/state')).json();
  const post = (value, csrf = state.token) => fetch(runtime.url+'/api/deepseek-token', {method:'POST', headers:{'Content-Type':'application/json','X-WhatsNew-Token':csrf}, body:JSON.stringify(value)});
  assert.equal((await post({token:'sk_test_private'}, '')).status, 403);
  const saved = await post({token:'sk_test_private'}); assert.equal(saved.status, 200);
  assert(!(await saved.text()).includes('sk_test_private'));
  assert.equal((await post({token:'bad\nvalue'})).status, 400);
  assert.equal((await readFile(service.deepseekCredentials.path,'utf8')).trim(), 'sk_test_private');
  assert(!(await (await fetch(runtime.url+'/api/state')).text()).includes('sk_test_private'));
  assert.equal((await fetch(runtime.url+'/config/deepseek.token')).status, 404);
  await post({remove:true}); assert.equal((await service.deepseekCredentials.status()).enabled, false);
});

test('independent model uses a private adapter, reads replacement token, and returns to DSH after deletion', async t => {
  const service = await fixture(t); let config, registrations = 0;
  const fallback = {provider:'shared',model:'existing'};
  const ctx = {agentDefaultModel:{currentSelection:() => fallback}, llm:{registerAdapter(routes, adapter) { assert.deepEqual(routes,['whatsnew-deepseek']); config=adapter.config; registrations++; return () => {}; }}, on() {}};
  const select = independentModel(ctx, service.deepseekCredentials, {load:async () => ({PUBLIC_BASE_URL:'https://api.deepseek.com',resolveAdapterOptions:() => ({models:[{id:'test-model'}]}),DeepSeekAdapter:class { constructor(value) { this.config = value; } }})});
  assert.equal(await select(), fallback); assert.equal(registrations,0);
  await service.deepseekCredentials.save('sk_first');
  assert.deepEqual(await select(), {provider:'whatsnew-deepseek', model:'test-model'});
  assert.equal(await config.resolveApiKey(), 'sk_first');
  await service.deepseekCredentials.save('sk_second'); assert.equal(await config.resolveApiKey(), 'sk_second');
  await select(); assert.equal(registrations,1);
  await service.deepseekCredentials.remove(); assert.equal(await select(),fallback);
});

test('overview cumulative points include earlier history and reject lifecycle gaps', () => {
  const now = new Date('2026-10-15T10:00:00Z'), history = lifecycle(now), cache = {[`${repo.id}:all`]:history};
  for (const period of ['week','month']) {
    const overview = calculateOverview([repo],cache,{period,now});
    assert.equal(overview.cumulativeCovered,1);
    const points = overview.projectTrends[0].totalPoints;
    assert.equal(points.length, period === 'week' ? 7 : 30);
    assert.equal(points.at(-1).stars, 80); // Forty complete days, excluding today.
    assert.equal(overview.values[repo.id], points.length*2);
    assert(points[0].stars > 2); // Never reset accumulated counts at the window boundary.
  }
  history.points.splice(0,1);
  const missing = calculateOverview([repo],cache,{now});
  assert.equal(missing.cumulativeCovered,0);
  assert(missing.projectTrends[0].totalPoints.every(p => p.stars === null));
});

test('cumulative collection reuses persisted lifecycle history; switching metrics during growth queues collection', async t => {
  const calls = []; let release;
  const wait = new Promise(resolve => { release=resolve; });
  const history = lifecycle();
  const service = await fixture(t,{github:{async starHistory(_repo, range) { calls.push(range); if(range === 90) await wait; return history; }}});
  service.visible=true; service.state.repos=[repo];
  service.startRanking('growth','week'); const first = service.rankingTask;
  service.startRanking('stars','week',false,'total'); release(); await first; await service.rankingTask;
  assert.deepEqual(calls,[90,'all']); assert.equal(service.snapshot().overview.cumulativeCovered,1);
  service.startRanking('stars','month',false,'total'); await service.rankingTask;
  assert.equal(calls.length,2);
  assert.equal(service.snapshot().overviews.month.projectTrends[0].totalPoints.length,windowDates('month').length);
});
