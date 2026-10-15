import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubClient } from '../src/github.js';
import { WhatsNewService } from '../src/service.js';
import { withCumulativeHistory, quantityHistory } from '../src/star-history.js';

const day = 86400000, repo = {id:'test/repo',name:'repo',stars:500,analyzed:true,analysisVersion:2};
const iso = time => new Date(time).toISOString().slice(0,10);
function history(now = new Date(), length = 1001, count = 1) {
  const end = Date.parse(now.toISOString().slice(0,10)), start = end-(length-1)*day;
  return {metric:'daily-new-stars',days:'all',createdAt:new Date(start).toISOString(),from:iso(start),to:iso(end),fetchedAt:now.toISOString(),points:Array.from({length},(_,i) => ({date:iso(start+i*day),stars:count}))};
}
function weeklyResponse(now, page, count = () => 1) {
  const today = Date.parse(now.toISOString().slice(0,10)), sunday = today-new Date(today).getUTCDay()*day;
  return Array.from({length:30},(_,i) => {
    const week = sunday-((page-1)*30+i)*7*day;
    const days = Array.from({length:7},(_,j) => count(iso(week+j*day)));
    return {week:week/1000,total:days.reduce((n,value) => n+value,0),days};
  });
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(),'whatsnew-performance-'));
  const service = new WhatsNewService({root,...options}); await service.init();
  service.state.repos=[repo]; service.visible=true;
  t.after(async () => { await service.close(); await rm(root,{recursive:true,force:true}); });
  return service;
}
const deferred = () => { let resolve; const promise = new Promise(done => {resolve=done;}); return {promise,resolve}; };

test('multiyear cumulative update fetches one recent page and incorporates overlap corrections exactly', async t => {
  const service = await fixture(t), first = new Date('2026-10-13T12:00:00Z'), next = new Date('2026-10-14T12:00:00Z');
  let clock=first, calls=0;
  const changed='2026-10-05';
  const client = new GitHubClient({root:service.root,token:null,fetcher:async url => {
    calls++; const page=Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify(weeklyResponse(clock,page,date => clock === next && date === changed ? 8 : 1)));
  }});
  const input = {...repo,createdAt:'2020-01-01T00:00:00Z'};
  const full = withCumulativeHistory(await client.starHistory(input,'all',undefined,first));
  const firstCalls=calls; assert(firstCalls > 10);
  calls=0; clock=next;
  const updated = withCumulativeHistory(await client.starHistory(input,'all',undefined,next,{previous:full}),full);
  assert.equal(calls,1);
  assert.equal(updated.cumulative.points[0],full.cumulative.points[0]);
  assert.equal(updated.points.find(p => p.date === changed).stars,8);
  assert.equal(updated.cumulative.points.at(-1).stars,full.cumulative.points.at(-1).stars+8);
  const rebuilt = quantityHistory({...updated,cumulative:undefined,updatedFrom:undefined},'all');
  assert.deepEqual(quantityHistory(updated,'all').points,rebuilt.points);
  t.diagnostic(`首次 ${firstCalls} 页，次日增量 ${calls} 页，累计结果与全量重算一致。`);
});

test('incremental refresh spans every missing day after a long absence instead of dropping the gap', async t => {
  const service=await fixture(t), before=new Date('2025-01-01T12:00:00Z'), after=new Date(before.getTime()+500*day);
  const previous=withCumulativeHistory(history(before)); let calls=0;
  const client=new GitHubClient({root:service.root,token:null,fetcher:async url => {
    calls++; return new Response(JSON.stringify(weeklyResponse(after,Number(new URL(url).searchParams.get('page')))));
  }});
  const updated=withCumulativeHistory(await client.starHistory({...repo,createdAt:previous.createdAt},'all',undefined,after,{previous}),previous);
  assert.equal(calls,3); assert.equal(updated.points.length,1501);
  assert.equal(updated.cumulative.points.at(-1).stars,1501);
});

test('same-day refresh replaces the unfinished day rather than counting it twice', async t => {
  const service=await fixture(t), now=new Date('2026-10-15T12:00:00Z');
  const previous=withCumulativeHistory(history(now)); let calls=0;
  const client=new GitHubClient({root:service.root,token:null,fetcher:async () => {
    calls++; return new Response(JSON.stringify(weeklyResponse(now,1,date => date===previous.to ? 9 : 1)));
  }});
  const updated=withCumulativeHistory(await client.starHistory(repo,'all',undefined,now,{previous}),previous);
  assert.equal(calls,1); assert.equal(updated.points.length,previous.points.length);
  assert.equal(updated.cumulative.points.at(-1).stars,previous.cumulative.points.at(-1).stars+8);
});

test('cumulative results survive restart and unchanged polls reuse both overview objects without resumming history', async t => {
  const service=await fixture(t);
  service.state.starHistories[`${repo.id}:all`]=history();
  await service.save();
  const restored=new WhatsNewService({root:service.root,github:{async starHistory(){throw Error('must use cache');}}});
  await restored.init(); t.after(() => restored.close());
  const saved=JSON.parse(await readFile(restored.statePath,'utf8'));
  assert.equal(saved.starHistories[`${repo.id}:all`].cumulative.points.length,1001);
  const data=restored.state.starHistories[`${repo.id}:all`];
  const first=restored.snapshot();
  Object.defineProperty(data.points,'map',{value:() => {throw Error('Polling must not scan full history');}});
  for(let i=0;i<100;i++) {
    const next=restored.snapshot(); assert.equal(next.overviews.week,first.overviews.week); assert.equal(next.overviews.month,first.overviews.month);
    assert.equal(quantityHistory(data,30).points.at(-1).stars,1001);
  }
  restored.state.repos[0].stars=900;
  // Remove the tripwire before a real data change invalidates the overview.
  // Array methods are inherited again on this copy, with identical daily data.
  data.points=[...data.points];
  const changed=restored.snapshot(); assert.notEqual(changed.overviews.week,first.overviews.week);
  restored.state.starHistories[`${repo.id}:all`]=withCumulativeHistory(history(new Date(),1001,2));
  const updated=restored.snapshot(); assert.notEqual(updated.overviews.week,changed.overviews.week);
  assert.equal(updated.overviews.week.projectTrends[0].totalPoints.at(-1).stars,2000);
});

test('rank collection starts exactly three concurrent requests, then completes all projects', async t => {
  const entered=deferred(), release=deferred(); let active=0, peak=0, calls=0;
  const service=await fixture(t,{github:{async starHistory(){
    calls++; active++; peak=Math.max(peak,active); if(calls===3) entered.resolve();
    await release.promise; active--; return history(new Date(),41);
  }}});
  service.state.repos=Array.from({length:8},(_,i) => ({...repo,id:`test/repo${i}`}));
  service.startRanking('stars','week',false,'total'); await entered.promise;
  assert.equal(calls,3); assert.equal(peak,3); release.resolve(); await service.rankingTask;
  assert.equal(calls,8); assert.equal(peak,3); assert.equal(service.rankingJob.status,'complete');
  assert.equal(service.snapshot().overview.cumulativeCovered,8);
});

test('rate limits stop new work and abort in-flight workers before the job becomes partial', async t => {
  const calls=[];
  const service=await fixture(t,{github:{async starHistory(input,_range,signal){
    calls.push(input.id);
    if(input.id==='test/repo0') throw Object.assign(new Error('quota'),{rateLimited:true});
    await new Promise((resolve,reject) => signal.addEventListener('abort',() => reject(signal.reason),{once:true}));
    throw Error('unreachable');
  }}});
  service.state.repos=Array.from({length:10},(_,i) => ({...repo,id:`test/repo${i}`}));
  service.startRanking(); await service.rankingTask;
  assert.equal(calls.length,3); assert.equal(service.rankingJob.status,'partial');
  assert.equal(service.rankingJob.errors.length,1); assert.match(service.rankingJob.errors[0],/quota/);
  assert.equal(service.historyTasks.size,0);
});

test('cancelling concurrent collection drains in-flight work and never starts queued collection', async t => {
  const entered=deferred(); let calls=0;
  const service=await fixture(t,{github:{async starHistory(_input,_range,signal){
    calls++; if(calls===3) entered.resolve();
    await new Promise((resolve,reject) => signal.addEventListener('abort',() => reject(signal.reason),{once:true}));
  }}});
  service.state.repos=Array.from({length:10},(_,i) => ({...repo,id:`test/repo${i}`}));
  service.startRanking(); await entered.promise; service.startRanking('stars','week',false,'total');
  service.cancel(); await service.rankingTask;
  assert.equal(calls,3); assert.equal(service.rankingJob.status,'cancelled'); assert.equal(service.pendingRanking,null);
  assert.equal(service.historyTasks.size,0);
});

test('incomplete incremental data does not overwrite a previously complete history cache', async t => {
  const service=await fixture(t), previous=withCumulativeHistory(history());
  service.state.starHistories[`${repo.id}:all`]=previous; await service.save();
  service.github={async starHistory(_input,_range,_signal,_now,options){
    assert.equal(options.previous,previous);
    return {...previous,cumulative:undefined,points:previous.points.slice(0,-1),updatedFrom:previous.to,fetchedAt:new Date().toISOString()};
  }};
  await assert.rejects(service.history(repo.id,30,true,undefined,'total'),/数据缺失/);
  assert.equal(service.state.starHistories[`${repo.id}:all`],previous);
  assert.equal(JSON.parse(await readFile(service.statePath,'utf8')).starHistories[`${repo.id}:all`].cumulative.points.length,1001);
});

test('failed persistence restores the previous cumulative and daily caches for a retry', async t => {
  const service=await fixture(t), previous=withCumulativeHistory(history());
  service.state.starHistories[`${repo.id}:all`]=previous;
  service.state.starHistories[`${repo.id}:90`]=service.recentHistory(previous,90);
  const oldRecent=service.state.starHistories[`${repo.id}:90`];
  service.github={async starHistory(){return history(new Date(),1001,2);}};
  service.saveHistories=async () => {throw new Error('disk full');};
  await assert.rejects(service.history(repo.id,30,true,undefined,'total'),/disk full/);
  assert.equal(service.state.starHistories[`${repo.id}:all`],previous);
  assert.equal(service.state.starHistories[`${repo.id}:90`],oldRecent);
});
