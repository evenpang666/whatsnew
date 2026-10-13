import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { WhatsNewService } from '../src/service.js';
import { GitHubClient } from '../src/github.js';
import { GitHubToken } from '../src/github-token.js';
import { isRepeatedIdea } from '../src/idea-history.js';
import { quantityHistory } from '../src/star-history.js';
import { startServer } from '../src/server.js';
import { windowDates } from '../src/ranking.js';
const execute=promisify(execFile),repo={id:'test/repo',owner:'test',name:'repo',branch:'main',stars:42,topics:[],description:'Test',analyzed:true,analysisVersion:2};
async function fixture(t,options={}) {
  const root=await mkdtemp('/tmp/whatsnew-cache-history-');const service=new WhatsNewService({root,...options});await service.init();
  t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});return service;
}
test('restart restores analyzed catalog, timestamp, cached trends and idea without calling GitHub or dsh',async t=>{
  const service=await fixture(t);const asOf='2025-01-13T09:00:00Z';
  service.state.repos=Array.from({length:100},(_,i)=>({...repo,id:`test/repo${i}`,summary:'缓存简介',tags:['缓存']}));service.state.analyzedAt=asOf;
  service.state.starHistories=Object.fromEntries(service.state.repos.map(r=>[`${r.id}:90`,{metric:'daily-new-stars',to:asOf.slice(0,10),fetchedAt:asOf,points:windowDates('month',new Date(asOf)).map(date=>({date,stars:2}))}]));
  service.state.inspiration={title:'已缓存的灵感',summary:'已保存的灵感简介',generatedAt:asOf,catalogHash:service.catalogHash()};await service.save();
  const restored=new WhatsNewService({root:service.root,github:{async top(){throw Error('Must not fetch');}},inspire:async()=>{throw Error('Must not generate');}});await restored.init();t.after(()=>restored.close());
  const snapshot=restored.snapshot();assert.equal(snapshot.repos.length,100);assert.equal(snapshot.analyzedAt,asOf);assert.equal(snapshot.visible,true);assert.equal(snapshot.inspirationReady,true);assert.equal(snapshot.overviews.week.values['test/repo0'],14);assert.equal(snapshot.inspiration.generatedAt,asOf);
});
test('empty catalog still lists every scanned Git project, plain source folder and standalone ZIP without invented analyses',async t=>{
  const service=await fixture(t);const gitPath=join(service.root,'downloads','repo');await mkdir(gitPath);await execute('git',['-C',gitPath,'init','-b','main']);await execute('git',['-C',gitPath,'remote','add','origin','https://github.com/test/repo.git']);
  const folder=join(service.root,'downloads','plain');await mkdir(folder);await writeFile(join(folder,'README.md'),'# Plain source');await writeFile(join(service.root,'downloads','manual.zip'),'ZIP');
  await service.scanDownloads(true);const snapshot=service.snapshot();assert.equal(snapshot.visible,false);assert.equal(snapshot.repos.length,3);assert.equal(snapshot.downloadedCount,3);
  for(const r of snapshot.repos){assert.equal(r.analyzed,false);assert.equal(r.summary,undefined);assert.equal(r.tags,undefined);}
  assert(snapshot.repos.some(r=>r.id==='test/repo'));assert(snapshot.repos.some(r=>r.localKind==='folder'));assert(snapshot.repos.some(r=>r.localKind==='archive'));
});
test('analysis synchronizes case-insensitive downloaded identities, descriptions and tags without losing physical paths',async t=>{
  const service=await fixture(t,{github:{async top(){return [{...repo,analyzed:false}];},async readme(){return {text:'Test',source:'README'};}},analyze:async batch=>batch.map(r=>({...r,summary:'新的项目简介',category:'开发工具',tags:['工具']}))});
  const path=join(service.root,'downloads','existing');await mkdir(path);await execute('git',['-C',path,'init','-b','main']);await execute('git',['-C',path,'remote','add','origin','https://github.com/Test/Repo.git']);
  await service.scanDownloads(true);assert(service.state.downloads['Test/Repo']);service.local.check=async record=>record;
  service.startAnalysis();await service.analysisTask;const snapshot=service.snapshot();assert.equal(snapshot.repos.length,1);assert.equal(snapshot.repos[0].id,repo.id);assert.equal(snapshot.repos[0].download.git.path,path);assert.deepEqual(snapshot.repos[0].tags,['工具']);assert.equal(service.state.downloads[repo.id].repo.summary,'新的项目简介');assert.equal(service.state.downloads['Test/Repo'],undefined);
});
test('a lifetime query paginates beyond 90 weeks and trims creation and future dates',async t=>{
  const service=await fixture(t);let calls=0;const now=new Date('2026-10-13T12:00:00Z'),latest=Date.parse('2026-10-11'),created=latest-120*7*86400000;
  const client=new GitHubClient({root:service.root,fetcher:async url=>{calls++;const page=Number(new URL(url).searchParams.get('page'));const rows=Array.from({length:30},(_,i)=>({week:(latest-((page-1)*30+i)*7*86400000)/1000,total:7,days:[1,1,1,1,1,1,1]}));return new Response(JSON.stringify(rows));}});
  const result=await client.starHistory({...repo,createdAt:new Date(created).toISOString()},'all',undefined,now);
  assert.equal(calls,5);assert.equal(result.points[0].date,new Date(created).toISOString().slice(0,10));assert.equal(result.points.at(-1).date,'2026-10-13');assert.equal(result.points.length,843);assert.equal(result.days,'all');
});
test('daily quantity includes counts before a selected window; incomplete lifetimes are rejected rather than starting from zero',()=>{
  const points=Array.from({length:40},(_,i)=>({date:new Date(Date.parse('2026-09-01')+i*86400000).toISOString().slice(0,10),stars:2}));
  const full={metric:'daily-new-stars',createdAt:'2026-09-01T00:00:00Z',to:points.at(-1).date,points};
  const result=quantityHistory(full,30);assert.equal(result.points.length,30);assert.equal(result.points[0].stars,22);assert.equal(result.points.at(-1).stars,80);assert.equal(result.metric,'cumulative-stars-created');assert.match(result.note,/不能代表当日净/);
  assert.equal(quantityHistory(full,'all').points.length,40);assert.throws(()=>quantityHistory({...full,points:points.slice(1)},30),/数据缺失/);
});
test('quantity and lifecycle growth share a persisted, deduplicated complete-history cache',async t=>{
  let calls=0;const today=new Date().toISOString().slice(0,10),created=new Date(Date.parse(today)-40*86400000).toISOString();
  const service=await fixture(t,{github:{async starHistory(_repo,range){calls++;assert.equal(range,'all');return {metric:'daily-new-stars',createdAt:created,to:today,fetchedAt:new Date().toISOString(),points:Array.from({length:41},(_,i)=>({date:new Date(Date.parse(created)+i*86400000).toISOString().slice(0,10),stars:1}))};}}});service.state.repos=[repo];
  const [total,growth]=await Promise.all([service.history(repo.id,30,false,undefined,'total'),service.history(repo.id,'all')]);assert.equal(calls,1);assert.equal(total.points.at(-1).stars,41);assert.equal(growth.points.length,41);
  await service.history(repo.id,365,false,undefined,'total');assert.equal(calls,1);assert(JSON.parse(await readFile(service.statePath)).starHistories[`${repo.id}:all`]);
});
test('Token file overrides environment/fallback, updates without restart and is stored with owner-only permissions',async t=>{
  const service=await fixture(t);const headers=[];const client=new GitHubClient({root:service.root,token:'environment_token',fetcher:async(_url,options)=>{headers.push(options.headers.Authorization);return new Response('{}');}});
  await client.api('/test');await client.credentials.save('file_token');await client.api('/test');await client.credentials.save('new_file_token');await client.api('/test');await client.credentials.remove();await client.api('/test');
  assert.deepEqual(headers,['Bearer environment_token','Bearer file_token','Bearer new_file_token','Bearer environment_token']);
  await client.credentials.save('file_token');assert.equal((await stat(client.credentials.path)).mode & 0o777,0o600);
  await assert.rejects(client.credentials.save('bad\nvalue'),/格式/);assert.equal(await client.credentials.get(),'file_token');
});
test('Token HTTP settings require CSRF, never return the secret, and are not served as a static file',async t=>{
  const service=await fixture(t);service.github=new GitHubClient({root:service.root,token:undefined});const runtime=await startServer(service,{port:0});t.after(()=>runtime.close());const owner=await(await fetch(runtime.url+'/api/state')).json();
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'qa_only_secret'})};assert.equal((await fetch(runtime.url+'/api/github-token',options)).status,403);
  const response=await fetch(runtime.url+'/api/github-token',{...options,headers:{...options.headers,'X-WhatsNew-Token':owner.token}});assert.equal(response.status,200);assert(!(await response.text()).includes('qa_only_secret'));
  const malformed=await fetch(runtime.url+'/api/github-token',{...options,headers:{...options.headers,'X-WhatsNew-Token':owner.token},body:'qa_only_secret'});assert.equal(malformed.status,400);assert(!(await malformed.text()).includes('qa_only_secret'));
  assert(!(await(await fetch(runtime.url+'/api/state')).text()).includes('qa_only_secret'));assert.equal((await fetch(runtime.url+'/config/github.token')).status,404);assert.equal((await readFile(join(service.root,'config','github.token'),'utf8')).trim(),'qa_only_secret');
});
test('Swap receives previous ideas, persists a different one, and keeps the old idea when generation repeats or fails',async t=>{
  let inputs,next={title:'新工作流',summary:'新的核心功能',problem:'问题',features:['特征']};const service=await fixture(t,{inspire:async(_repos,_signal,options)=>{inputs=options.previousIdeas;return next;}});service.visible=true;service.analysisFinished=true;service.state.repos=Array.from({length:100},(_,i)=>({...repo,id:`test/repo${i}`}));
  const old={title:'原始工作流',summary:'原始核心功能',generatedAt:'2025-01-01',catalogHash:service.catalogHash()};service.state.inspiration=old;
  service.startInspiration(true);await service.inspirationTask;assert.equal(inputs[0].title,old.title);const saved=service.state.inspiration;assert.equal(saved.title,next.title);assert(saved.generatedAt);assert.equal(service.state.ideaHistory.length,1);
  service.startInspiration(true);await service.inspirationTask;assert.equal(service.inspirationJob.status,'error');assert.equal(service.state.inspiration.id,saved.id);
  service.inspire=async()=>{throw Error('network error');};service.startInspiration(true);await service.inspirationTask;assert.equal(service.state.inspiration.id,saved.id);assert.equal(JSON.parse(await readFile(service.statePath)).inspiration.id,saved.id);
});

test('renaming an unchanged problem and feature set does not count as a fresh idea',()=>{
 const old={title:'原标题',summary:'原简介',problem:'同一问题',features:['第一项','第二项']};
 assert.equal(isRepeatedIdea({title:'新标题',summary:'新简介',problem:'同一问题',features:['第二项','第一项']},[old]),true);
 assert.equal(isRepeatedIdea({title:'新标题',summary:'新简介',problem:'另一问题',features:['新功能']},[old]),false);
});
