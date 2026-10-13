import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhatsNewService } from '../src/service.js';
import { GitHubClient, hasUpdate } from '../src/github.js';
import { startServer } from '../src/server.js';
import { validateProjectAnalysis } from '../src/contracts.js';

const repo = {id:'test/repo',name:'repo',owner:'test',branch:'main',stars:42,rank:1,analyzed:false};
const classification = {id:repo.id,summary:'用于测试真实状态流转的项目。',category:'开发工具',tags:['测试','工具']};
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(),'whatsnew-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const service = new WhatsNewService({root,...options}); await service.init(); return service;
}
test('project analysis validates repository identity, category and source evidence',()=>{
  const r={...repo,description:'A local test tool.'};
  const value={...classification,audience:'使用本地测试工具的开发者',categoryReason:'主要用途是提供本地测试工具，因此归入开发工具。',capabilities:[{text:'本地测试工具',source:'description',quote:'local test tool'}],limitations:[]};
  assert.equal(validateProjectAnalysis(value,r).analyzed,true);
  assert.throws(()=>validateProjectAnalysis({...value,id:'evil/repo'},r));
  assert.throws(()=>validateProjectAnalysis({...value,category:'不存在的类别'},r));
  assert.throws(()=>validateProjectAnalysis({...value,capabilities:[]},r));
});
test('version comparison detects releases and commit changes without inventing missing versions',()=>{
  assert.equal(hasUpdate({version:'release:v1'},{version:'release:v2'}),true);
  assert.equal(hasUpdate({version:'commit:abc'},{version:'commit:abc'}),false);
  assert.equal(hasUpdate({version:'commit:abc'},{version:null}),false);
  assert.equal(hasUpdate(null,{version:'release:v1'}),false);
  assert.equal(hasUpdate({version:null},{version:'release:v1'}),false);
});
test('partial analysis persists validated batches and resume skips completed projects',async t=>{
  const repos=Array.from({length:12},(_,i)=>({...repo,id:`test/repo${i}`})); let failed=false; const calls=[];
  const service=await fixture(t,{github:{async top(){return repos;},async readme(){return {text:'readme',source:'README'};}},analyze:async batch=>{
    calls.push(batch.map(r=>r.id)); if(batch.length===2&&!failed){failed=true;throw new Error('temporary model failure');}
    return batch.map(r=>({...classification,id:r.id,analyzed:true}));
  }});
  service.startAnalysis(); await service.analysisTask;
  assert.equal(service.job.status,'partial');assert.equal(service.job.progress,10);
  service.startAnalysis(true);await service.analysisTask;assert.equal(service.job.status,'complete');assert.equal(service.job.progress,12);
  assert.equal(calls.at(-1).length,2);
  const saved=JSON.parse(await readFile(service.statePath,'utf8'));assert.equal(saved.repos.filter(r=>r.analyzed).length,12);
  assert.equal('history' in saved,false);assert.deepEqual(saved.starHistories,{});
});
test('download marks success only after full archive is written; failure leaves no downloaded record',async t=>{
  let success=false;
  const github={async detail(){return {version:'commit:abc',versionLabel:'abc',archiveUrl:'https://codeload.github.com/test/repo/zip/abc',checkedAt:new Date().toISOString()};},async fetcher(){return success?new Response(new Uint8Array([0x50,0x4b,3,4])):new Response('error',{status:500});}};
  const service=await fixture(t,{github}); service.state.repos=[{...repo}];
  await assert.rejects(service.download(repo.id));assert.equal(service.snapshot().downloadedCount,0);
  success=true;const result=await service.download(repo.id);
  assert.equal(result.size,4);assert.equal((await stat(result.path)).size,4);assert.equal(service.snapshot().downloadedCount,1);
  assert.equal(service.state.downloads[repo.id].version,'commit:abc');
});
test('downloaded repositories survive falling out of Top 100 and update checks use saved repo',async t=>{
  const service=await fixture(t,{github:{async detail(){return {version:'release:v2',checkedAt:new Date().toISOString()};}}}); service.visible=true;
  await writeFile(join(service.root,'downloads','saved.zip'),'ZIP');
  service.state.downloads[repo.id]={version:'release:v1',filename:'saved.zip',repo:{...repo,analyzed:true,analysisVersion:2}};
  assert.equal(service.snapshot().repos[0].archived,true);
  const result=await service.checkUpdates();assert.equal(result.count,1);assert.equal(service.snapshot().repos[0].update,true);
});
test('closing service cancels active downloads without marking an incomplete file',async t=>{
  let started;
  const ready = new Promise(resolve=>started=resolve);
  const service = await fixture(t,{github:{async detail(){return {version:'commit:abc',versionLabel:'abc',archiveUrl:'https://codeload.github.com/test/repo/zip/abc',checkedAt:new Date().toISOString()};},async fetcher(_url,{signal}){started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}}});
  service.state.repos=[repo];
  const downloading=service.download(repo.id);const rejected=assert.rejects(downloading,/aborted/);
  await ready;await service.close();await rejected;
  assert.equal(service.snapshot().downloadedCount,0);assert.equal(service.downloadTasks.size,0);
});
test('release download stats sum assets and ignore prerelease when selecting download version',async()=>{
  const client=new GitHubClient({fetcher:async url=>new Response(JSON.stringify(url.includes('/releases')?[{draft:false,prerelease:true,tag_name:'v3-beta',assets:[{download_count:20}]},{draft:false,prerelease:false,tag_name:'v2',assets:[{download_count:30,browser_download_url:'https://github.com/a.zip'}]}]:[{sha:'a'.repeat(40),commit:{message:'fix',author:{date:'2026-10-13'}},html_url:'https://github.com/a'}]))});
  const detail=await client.detail(repo);assert.equal(detail.version,'release:v2');assert.equal(detail.releaseDownloads,50);
});
test('star history queries real weekly records and retains zero-star days while excluding future days',async()=>{
  let request;
  const week = Date.parse('2026-10-11T00:00:00Z')/1000;
  const client=new GitHubClient({fetcher:async(url,options)=>{request={url,options};return new Response(JSON.stringify([
    {week,total:150,days:[65,85,0,0,0,0,0]},
    {week:week-7*86400,total:28,days:[1,2,3,4,5,6,7]}
  ]));}});
  const result=await client.starHistory(repo,30,undefined,new Date('2026-10-13T06:00:00Z'));
  assert.equal(request.options.headers['X-GitHub-Api-Version'],'2026-03-10');
  assert.match(request.url,/stargazers\/history/);
  assert.equal(result.points.length,10);
  assert.deepEqual(result.points.at(-1),{date:'2026-10-13',stars:0});
  assert.deepEqual(result.points[0],{date:'2026-10-04',stars:1});
  assert.equal(result.points.reduce((n,p)=>n+p.stars,0),178);
  assert.equal(result.metric,'daily-new-stars');
});
test('one-year history paginates across more than 30 weeks and trims exactly to requested calendar range',async()=>{
  const latest=Date.parse('2026-10-11T00:00:00Z')/1000;const calls=[];
  const client=new GitHubClient({fetcher:async url=>{
    const page=Number(new URL(url).searchParams.get('page'));calls.push(page);
    const rows=Array.from({length:30},(_,i)=>({week:latest-((page-1)*30+i)*7*86400,total:7,days:[1,1,1,1,1,1,1]}));
    return new Response(JSON.stringify(rows));
  }});
  const result=await client.starHistory(repo,365,undefined,new Date('2026-10-13T06:00:00Z'));
  assert.deepEqual(calls,[1,2]);assert.equal(result.points.length,365);
  assert.equal(result.points[0].date,'2025-10-14');assert.equal(result.points.at(-1).date,'2026-10-13');
});
test('history rejects malformed data and unsupported ranges instead of fabricating a curve',async()=>{
  const client=new GitHubClient({fetcher:async()=>new Response(JSON.stringify([{week:1791676800,total:1,days:[1]}]))});
  await assert.rejects(client.starHistory(repo,90),/格式无效/);
  await assert.rejects(client.starHistory(repo,999),/查询范围/);
});
test('history can be queried before analysis and caches/deduplicates per range, with explicit refresh',async t=>{
  let calls=0;
  const service=await fixture(t,{github:{async starHistory(_repo,days){calls++;await new Promise(r=>setImmediate(r));return {points:[{date:'2026-10-01',stars:8}],days,metric:'daily-new-stars',fetchedAt:new Date().toISOString(),to:new Date().toISOString().slice(0,10)};}}});
  service.state.repos=[repo];
  const [first,second]=await Promise.all([service.history(repo.id,90),service.history(repo.id,90)]);
  assert.equal(calls,1);assert.deepEqual(first,second);
  await service.history(repo.id,90);assert.equal(calls,1);
  await service.history(repo.id,90,true);assert.equal(calls,2);
  await service.history(repo.id,30);assert.equal(calls,3);
  assert.equal(service.state.analyzedAt,null);
  await assert.rejects(service.history('not/in-catalog',90),/项目不存在/);
});
test('old analysis snapshots are retired and never returned as project history',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whatsnew-migration-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'.runtime'));await writeFile(join(root,'.runtime','state.json'),JSON.stringify({repos:[repo],history:{[repo.id]:[{date:'2026-10-13',stars:42}]}}));
  const service=new WhatsNewService({root,github:{async detail(){return {checkedAt:new Date().toISOString()};},async starHistory(){throw new Error('history unavailable');}}});await service.init();
  assert.equal('history' in service.state,false);assert.equal('history' in await service.detail(repo.id),false);
  await assert.rejects(service.history(repo.id),/history unavailable/);assert.deepEqual(service.state.starHistories,{});
});
test('HTTP API protects mutations from missing CSRF tokens and foreign origins',async t=>{
  const service=await fixture(t,{github:{async top(){throw new Error('network offline');}}});
  const runtime=await startServer(service,{port:0});t.after(()=>runtime.close());
  const state=await (await fetch(runtime.url+'/api/state')).json();assert.equal(typeof state.token,'string');
  assert.equal((await fetch(runtime.url+'/api/analyze',{method:'POST'})).status,403);
  assert.equal((await fetch(runtime.url+'/api/analyze',{method:'POST',headers:{'X-WhatsNew-Token':state.token,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(runtime.url+'/api/state',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await fetch(runtime.url+'/api/analyze',{method:'POST',headers:{'X-WhatsNew-Token':state.token}})).status,202);
  await service.analysisTask;assert.equal(service.job.status,'error');assert.equal(service.job.message,'network offline');
  assert.equal((await fetch(runtime.url+'/')).status,200);assert.equal((await fetch(runtime.url+'/../README.md')).status,404);
});
