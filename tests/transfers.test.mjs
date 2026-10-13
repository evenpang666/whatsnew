import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { WhatsNewService } from '../src/service.js';
import { LocalProjects, parseGitProgress } from '../src/local-projects.js';
import { fullWindow, zoomWindow, panWindow } from '../public/chart-window.js';
const repo = { id:'test/repo', owner:'test', name:'repo', branch:'main', stars:42, analyzed:true, analysisVersion:2 };
const detail = { version:'commit:abc', versionLabel:'abc', archiveUrl:'https://codeload.github.com/test/repo/zip/abc', checkedAt:new Date().toISOString() };
async function fixture(t, github) {
  const root = await mkdtemp('/tmp/whatsnew-transfer-');
  const service = new WhatsNewService({root, github}); await service.init(); service.state.repos=[repo]; service.visible=true;
  t.after(async () => { await service.close(); await rm(root,{recursive:true,force:true}); }); return service;
}
async function until(predicate) {
  for(let i=0;i<200;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,5)); }
  throw new Error('Timed out waiting for transfer status');
}
test('zoom anchors date coordinates, clamps edges and restores full range; panning keeps its span',()=>{
  for(const length of [7,30]) {
    const full=fullWindow(length), z=zoomWindow(full,length,2,.25);
    assert.equal(z.start+(z.end-z.start)*.25,(length-1)*.25);
    const p=panWindow(z,length,1);assert.equal(p.end-p.start,z.end-z.start);
    assert.equal(panWindow(z,length,-100).start,0);assert.equal(panWindow(z,length,100).end,length-1);
    assert.deepEqual(zoomWindow(z,length,.001),full);assert.equal(zoomWindow(z,length,100).end-zoomWindow(z,length,100).start,1);
  }
  assert.throws(()=>zoomWindow(fullWindow(7),7,0));assert.throws(()=>panWindow(fullWindow(7),7,NaN));
});
test('ZIP progress reports actual bytes before completion and is visible to another state reader',async t=>{
  let stream;const service=await fixture(t,{async detail(){return detail;},async fetcher(){return new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'Content-Length':'8'}});}});
  const task=service.download(repo.id);await until(()=>stream);
  stream.enqueue(new Uint8Array([80,75,3,4]));await until(()=>service.state.operations[repo.id].loaded===4);
  const op=service.snapshot().repos[0].operation;assert.equal(op.percent,50);assert.equal(op.total,8);assert.equal(op.status,'running');assert.equal(service.state.downloads[repo.id],undefined);
  stream.enqueue(new Uint8Array([1,2,3,4]));stream.close();const result=await task;
  assert.equal((await readFile(result.path)).length,8);assert.equal(op.status,'success');assert.equal(op.percent,100);
  const saved=JSON.parse(await readFile(service.statePath));assert.equal(saved.operations[repo.id].status,'success');
});
test('unknown download size stays indeterminate; interrupted transfer keeps old archive and persistent error, retry clears it',async t=>{
  let controller,mode='good';const service=await fixture(t,{async detail(){return detail;},async fetcher(){return mode==='good'?new Response(new Uint8Array([80,75,3,4])):new Response(new ReadableStream({start(c){controller=c;}}));}});
  const good=await service.download(repo.id);mode='fail';const failed=service.download(repo.id);const rejection=assert.rejects(failed,/connection lost/);
  await until(()=>controller);controller.enqueue(new Uint8Array([1,2]));await until(()=>service.state.operations[repo.id].loaded===2);
  assert.equal(service.state.operations[repo.id].percent,null);assert.equal(service.state.operations[repo.id].total,null);
  controller.error(new Error('connection lost'));await rejection;
  const error=service.snapshot().repos[0].operation;assert.equal(error.status,'error');assert.match(error.error,/connection lost/);
  assert.deepEqual([...await readFile(good.path)],[80,75,3,4]);assert.equal((await readdir(join(service.root,'downloads'))).some(n=>n.endsWith('.part')),false);
  const saved=JSON.parse(await readFile(service.statePath));assert.match(saved.operations[repo.id].error,/connection lost/);
  mode='good';await service.download(repo.id);assert.equal(service.state.operations[repo.id].status,'success');assert.equal(service.state.operations[repo.id].error,null);
});
test('declared incomplete ZIP fails and cleans its partial file',async t=>{
  const service=await fixture(t,{async detail(){return detail;},async fetcher(){return new Response(new Uint8Array([1,2]),{headers:{'Content-Length':'4'}});}});
  await assert.rejects(service.download(repo.id),/不完整/);assert.equal(service.state.operations[repo.id].loaded,2);assert.equal(service.state.operations[repo.id].status,'error');assert.equal(service.state.downloads[repo.id],undefined);
  assert.deepEqual(await readdir(join(service.root,'downloads')),[]);
});
test('Git progress parses numeric stages from fragmented stderr without leaking diagnostics',async t=>{
  const root=await mkdtemp('/tmp/whatsnew-git-progress-');t.after(()=>rm(root,{recursive:true,force:true}));
  const reports=[];let release,stderr;
  const projects=new LocalProjects(root,{runner:(_command,args,options)=>{
    assert.equal(options.env.LC_ALL,'C');assert(args.includes('--progress'));
    const pending=new Promise(r=>{release=r;});stderr=new PassThrough();pending.child={stderr};return pending;
  }});
  const task=projects.git(root,['clone','--progress'],undefined,p=>reports.push(p));await until(()=>stderr);
  stderr.write('fatal: https://secret@github.com/owner/repo\nReceiving obj');stderr.write('ects:  25% (1/4)\rReceiving objects: 100% (4/4)\nResolving deltas: 50% (1/2)\r');
  release({stdout:''});await task;assert.deepEqual(reports.map(r=>r.percent),[25,100,50]);assert.equal(reports[0].phase,'接收对象…');assert(!JSON.stringify(reports).includes('secret'));
  assert.equal(parseGitProgress('fatal: permission denied'),null);
});
test('Git pull failure survives state polling and retry has a fresh operation identity',async t=>{
  const service=await fixture(t,{});service.scanDownloads=async()=>{};
  service.state.downloads[repo.id]={git:{path:'/unused',branch:'main'}};
  service.local.pull=async(_record,_id,_signal,onProgress)=>{onProgress({phase:'接收对象…',percent:25});throw new Error('网络断开，请重试。');};
  await assert.rejects(service.gitOperation(repo.id,'pull'),/网络断开/);const previous=service.snapshot().repos[0].operation;
  assert.equal(previous.status,'error');assert.equal(previous.percent,25);assert.match(previous.error,/网络断开/);
  service.local.pull=async()=>({path:'/unused'});await service.gitOperation(repo.id,'pull');const next=service.snapshot().repos[0].operation;
  assert.notEqual(next.id,previous.id);assert.equal(next.status,'success');assert.equal(next.error,null);
});
test('restart turns unfinished download into a retryable error rather than a permanently busy card',async t=>{
  const service=await fixture(t,{});service.beginOperation(repo.id,'zip');await service.save();
  const restarted=new WhatsNewService({root:service.root,github:{}});await restarted.init();t.after(()=>restarted.close());
  assert.equal(restarted.state.operations[repo.id].status,'error');assert.match(restarted.state.operations[repo.id].error,/被中断/);
});
