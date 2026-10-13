import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectUsage, emptyUsage, addUsage, referencePrice } from '../src/usage.js';
import { WhatsNewService } from '../src/service.js';
import { calculateOverview, windowDates } from '../src/ranking.js';
const route={provider:'deepseek-official',model:'deepseek-flash'};
function session(turns){const events=turns.flatMap((u,i)=>[{type:'turn/start',data:{turn:i}},{type:'assistant/message',data:{usage:u}},{type:'turn/end',data:{turn:i}}]);return {seq:events.length,eventAt:i=>events[i]};}
const fold=events=>{const u=events.find(e=>e.type==='assistant/message').data.usage;if(!u)return;return {uncachedInputTokens:u.inputTokens,outputTokens:u.outputTokens,cacheReadTokens:u.cacheReadTokens,cacheWriteTokens:u.cacheWriteTokens,totalTokens:u.totalTokens,routes:[route]};};
test('usage adds all repair turns, includes cache tokens, and does not double-count reasoning',async()=>{
 const u={inputTokens:1000,outputTokens:400,totalTokens:1600,cacheReadTokens:200,reasoningTokens:300};
 const total=await collectUsage(session([u,u]),route,{deriveTurn:fold});
 assert.equal(total.complete,true);assert.equal(total.totalTokens,3200);assert.equal(total.outputTokens,800);assert.equal(total.inputTokens,2000);assert.equal(total.cacheReadTokens,400);
 assert.ok(Math.abs(total.costMinUsd-(2000*.15+400*.003+800*.6)/1e6)<1e-12);assert.equal(total.costMaxUsd,total.costMinUsd*2);
});
test('missing accounting yields a known lower bound, never a zero-price complete task',async()=>{
 const total=await collectUsage(session([{inputTokens:1000,outputTokens:100,totalTokens:1100},null]),route,{deriveTurn:fold});
 assert.equal(total.totalTokens,1100);assert.equal(total.complete,false);assert.equal(total.pricingComplete,false);assert.equal(total.missingTurns,1);
 const missing=await collectUsage(session([null]),route,{deriveTurn:fold});assert.equal(missing.reportedTurns,0);assert.equal(missing.complete,false);
});
test('unknown models have no invented quote; explicit USD pricing can provide an estimate',async()=>{
 const u={inputTokens:1000,outputTokens:100,totalTokens:1100};const model={provider:'custom',model:'my-private-model'};
 const deriveTurn=()=>({uncachedInputTokens:1000,outputTokens:100,totalTokens:1100,routes:[model]});
 assert.equal(referencePrice(model.model),null);
 const unknown=await collectUsage(session([u]),model,{deriveTurn});assert.equal(unknown.complete,true);assert.equal(unknown.pricingComplete,false);
 const configured=await collectUsage(session([u]),model,{deriveTurn,pricing:{input:1,cacheRead:.1,output:3}});assert.equal(configured.pricingComplete,true);assert.equal(configured.costMinUsd,.0013);assert.equal(configured.costMaxUsd,.0013);
});
test('cached actions cost zero; independent task counters do not carry previous charges',()=>{
 const a=emptyUsage(),b=emptyUsage();addUsage(a,{...emptyUsage(),sessions:1,reportedTurns:1,totalTokens:42,models:['model']});assert.equal(a.totalTokens,42);assert.equal(b.totalTokens,0);assert.equal(b.costMaxUsd,0);
});
test('one Analyze waits for history as well as model analysis; both viewing windows are ready without extra calls',async t=>{
 const root=await mkdtemp(join(tmpdir(),'whatsnew-both-'));let models=0,histories=0,inspires=0,releaseHistory;const ready=new Promise(r=>releaseHistory=r);
 const repo={id:'test/repo',name:'repo',owner:'test',branch:'main',stars:42,topics:[]};
 const service=new WhatsNewService({root,github:{async top(){return [repo];},async readme(){return {text:'test',source:'README'};},async starHistory(){histories++;await ready;return {metric:'daily-new-stars',to:new Date().toISOString().slice(0,10),fetchedAt:new Date().toISOString(),points:windowDates('month').map(date=>({date,stars:2}))};}},analyze:async(batch,_signal,{onUsage})=>{models++;await onUsage({...emptyUsage(),sessions:1,reportedTurns:1,totalTokens:99});return batch.map(r=>({...r,analyzed:true}));},inspire:async()=>{inspires++;}});await service.init();t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 service.startAnalysis();await new Promise(r=>setImmediate(r));assert.equal(service.job.status,'running');assert.equal(service.snapshot().inspirationReady,false);
 releaseHistory();await service.analysisTask;assert.equal(service.job.status,'complete');assert.equal(histories,1);assert.equal(models,1);assert.equal(inspires,0);assert.equal(service.snapshot().usage.analysis.totalTokens,99);
 const all=service.snapshot().overviews;assert.equal(all.day,undefined);assert.equal(all.week.values[repo.id],14);assert.equal(all.month.values[repo.id],60);
 service.setRanking('growth','month');service.snapshot();assert.equal(histories,1);assert.equal(models,1);
 service.startAnalysis();await service.analysisTask;assert.equal(service.state.usage.analysis.sessions,0);assert.equal(service.state.usage.analysis.totalTokens,0);assert.equal(models,1);
});
test('each project has its own trend; missing points stay gaps instead of disappearing or turning zero',()=>{
 const now=new Date('2026-10-13T09:00:00Z'),repos=[{id:'a/one',stars:100},{id:'b/two',stars:50}];const dates=windowDates('week',now);
 const histories={'a/one:90':{metric:'daily-new-stars',to:'2026-10-13',points:dates.map(date=>({date,stars:3}))},'b/two:90':{metric:'daily-new-stars',to:'2026-10-13',points:[{date:dates[0],stars:7}]}};
 const overview=calculateOverview(repos,histories,{period:'week',now});assert.equal(overview.projectTrends.length,2);assert.equal(overview.projectTrends[0].points.length,7);assert.equal(overview.projectTrends[1].points[0].stars,7);assert.equal(overview.projectTrends[1].points[1].stars,null);
});
