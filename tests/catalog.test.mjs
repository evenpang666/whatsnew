import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { LocalProjects, githubIdentity } from '../src/local-projects.js';
import { calculateOverview, windowDates } from '../src/ranking.js';
import { lanAddresses } from '../src/network.js';
import { WhatsNewService } from '../src/service.js';
import { startServer } from '../src/server.js';
const execute = promisify(execFile);
const repo = {id:'test/repo',owner:'test',name:'repo',branch:'main',stars:42,topics:[],description:'A test tool',analyzed:true,analysisVersion:2};
async function fixture(t, options={}) {
  const root=await mkdtemp(join(tmpdir(),'whatsnew-catalog-')); const service=new WhatsNewService({root,...options});await service.init();
  t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});return service;
}
const git = async (path,...args) => (await execute('git',['-C',path,...args],{env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();
async function worktree(service, name='existing', remote) {
  const path=join(service.root,'downloads',name);await mkdir(path,{recursive:true});await git(path,'init','-b','main');
  await writeFile(join(path,'README.md'),'# Test project\nA tool for local scientific data exploration.');
  await git(path,'add','README.md');await git(path,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','initial');
  if(remote)await git(path,'remote','add','origin',remote);return path;
}
const analysis = async (batch,_signal,{onResult}={}) => {
  const rows=batch.map(r=>({id:r.id,summary:'分析本地科学数据的项目工具。',category:'科研学术',tags:['数据探索','本地工具'],analyzed:true}));
  for(const row of rows)await onResult?.(row);return rows;
};
function histories(repos, now=new Date('2026-10-13T09:00:00Z')) {
  return Object.fromEntries(repos.map((r,i)=>[`${r.id}:90`,{metric:'daily-new-stars',to:now.toISOString().slice(0,10),fetchedAt:now.toISOString(),points:[...windowDates('month',now).map(date=>({date,stars:i+1})),{date:now.toISOString().slice(0,10),stars:100000}]}]));
}
test('LAN URLs only include 192.168 IPv4 addresses, excluding 10/172 and IPv6',()=>{
  assert.deepEqual(lanAddresses({eth0:[{family:'IPv4',internal:false,address:'192.168.2.3'},{family:'IPv4',internal:false,address:'192.168.2.3'},{family:'IPv4',internal:true,address:'127.0.0.1'},{family:'IPv6',internal:false,address:'::1'},{family:'IPv4',internal:false,address:'10.85.35.79'},{family:'IPv4',internal:false,address:'172.17.0.1'},{family:'IPv4',internal:false,address:'8.8.8.8'}]}),['192.168.2.3']);
});

test('LAN URLs retain Ethernet and exclude VMware, other virtual adapters and Wi-Fi',()=>{
  const ipv4=address=>[{family:'IPv4',internal:false,address}];
  assert.deepEqual(lanAddresses({
    '以太网':ipv4('192.168.10.106'),
    'Ethernet 2':ipv4('192.168.10.106'),
    'VMware Network Adapter VMnet1':ipv4('192.168.112.1'),
    'VMware Network Adapter VMnet8':ipv4('192.168.146.1'),
    'vEthernet (Default Switch)':ipv4('192.168.20.1'),
    'VirtualBox Host-Only Ethernet Adapter':ipv4('192.168.56.1'),
    '以太网 虚拟':ipv4('192.168.30.1'),
    'Wi-Fi':ipv4('192.168.10.107'),
    'WLAN':ipv4('192.168.10.108'),
    'tun0':ipv4('192.168.40.1'),
  }),['192.168.10.106']);
  assert.deepEqual(lanAddresses({'VMware Network Adapter VMnet1':ipv4('192.168.112.1')}),[]);
  for(const name of ['以太网 2','Ethernet','eth0','eno1','ens33','enp3s0','enx001122334455','en0']) {
    assert.deepEqual(lanAddresses({[name]:ipv4('192.168.2.3')}),['192.168.2.3']);
  }
});
test('GitHub origin parsing excludes local, lookalike, credential leaks and unrelated hosts',()=>{
  for(const remote of ['https://github.com/a/b.git','git@github.com:a/b.git','ssh://git@github.com/a/b.git'])assert.equal(githubIdentity(remote),'a/b');
  for(const remote of ['/tmp/repo','https://github.com.evil/a/b','https://gitlab.com/a/b','https://github.com/a/b/extra'])assert.equal(githubIdentity(remote),null);
});
test('weekly/monthly growth ranks official history and excludes today; gaps stay unknown',()=>{
  const now=new Date('2026-10-13T09:00:00Z'); const repos=[{...repo,id:'a/one',stars:100,category:'开发工具'},{...repo,id:'b/two',stars:40,category:'科研学术'},{...repo,id:'c/missing',stars:200}];
  assert.throws(()=>windowDates('day',now),/周、月/);
  const cache=histories(repos,now);delete cache['c/missing:90'];
  for(const [period,days] of [['week',7],['month',30]]){
    const result=calculateOverview(repos,cache,{period,mode:'growth',now});
    assert.equal(result.values['a/one'],days);assert.equal(result.values['b/two'],days*2);assert.equal(result.values['c/missing'],null);
    assert.equal(result.ranks['b/two'],1);assert.equal(result.ranks['a/one'],2);assert.equal(result.ranks['c/missing'],undefined);
    assert.equal(result.trend.length,days);assert.equal(result.trend[0].stars,3);assert.equal(result.covered,2);assert.equal(result.complete,false);
    assert.equal(result.histogram.reduce((n,b)=>n+b.count,0),3);assert.equal(Object.values(result.categories).reduce((n,c)=>n+c,0),3);
  }
  delete cache['a/one:90'].points[0];cache['a/one:90'].points=cache['a/one:90'].points.filter(Boolean);
  assert.equal(calculateOverview(repos,cache,{period:'month',now}).values['a/one'],null);
});
test('all-zero history ranks as zero; stale last-day data is not a complete current window',()=>{
  const now=new Date('2026-10-13T09:00:00Z');const cache=histories([repo],now);cache['test/repo:90'].points.forEach(p=>p.stars=0);
  assert.equal(calculateOverview([repo],cache,{now}).values[repo.id],0);
  cache['test/repo:90'].to='2026-10-12';assert.equal(calculateOverview([repo],cache,{now}).covered,0);
});
test('a fresh session is empty until Analyze; unchanged evidence reuses validated analysis',async t=>{
  let modelCalls=0;const service=await fixture(t,{github:{async top(){return [{...repo,analyzed:false}];}},analyze:async()=>{modelCalls++;throw new Error('should not run');}});
  service.state.repos=[repo];assert.deepEqual(service.snapshot().repos,[]);assert.equal(service.snapshot().overview,null);
  service.startAnalysis();await service.analysisTask;assert.equal(service.job.status,'complete');assert.equal(modelCalls,0);assert.equal(service.snapshot().repos.length,1);
});
test('disk existence wins over stale download cache; ZIP index survives runtime cache loss',async t=>{
  const service=await fixture(t);service.state.repos=[repo];service.visible=true;
  const zip={filename:'test--repo-release_v1.zip',version:'release:v1',versionLabel:'v1',size:3};
  await writeFile(join(service.root,'downloads',zip.filename),'ZIP');service.state.downloads[repo.id]={...zip,zip,repo};await service.local.saveIndex(service.state.downloads);
  service.state.downloads={};await service.scanDownloads(true);assert.equal(service.snapshot().downloadedCount,1);assert.equal(service.state.downloads[repo.id].zip.version,'release:v1');
  await rm(join(service.root,'downloads',zip.filename));await service.scanDownloads(true);assert.equal(service.snapshot().downloadedCount,0);assert.equal(service.snapshot().repos[0].download,null);
});
test('scan discovers external GitHub and local repositories while ignoring symlink escapes',async t=>{
  const service=await fixture(t);await worktree(service,'outside-top','git@github.com:someone/other.git');await worktree(service,'local-project','https://gitlab.com/owner/private.git');
  await symlink(service.root,join(service.root,'downloads','escape'),'dir');
  await mkdir(join(service.root,'downloads','invalid','.git'),{recursive:true});await service.scanDownloads(true);
  assert.equal(service.snapshot().downloadedCount,2);assert.equal(service.state.localRepos.find(r=>r.id==='someone/other').localOnly,false);
  assert.equal(service.state.localRepos.filter(r=>r.localOnly).length,1);assert.equal(service.scanWarnings.length,1);
});
test('non-GitHub Git projects are analyzed from README with no network update or download',async t=>{
  let inputs;let network=0;
  const service=await fixture(t,{github:{async repository(){network++;throw new Error('not allowed');},async detail(){network++;throw new Error('not allowed');}},analyze:async (...args)=>{inputs=args[0];return analysis(...args);}});
  await worktree(service);await service.checkUpdates();const local=service.state.localRepos[0];service.visible=true;
  assert.equal(network,0);assert.match(inputs[0].readme,/scientific data/);assert.equal(local.category,'科研学术');assert.equal(service.snapshot().repos[0].localOnly,true);
  assert.equal((await service.detail(local.id)).update,false);
  await assert.rejects(service.gitOperation(local.id,'pull'),/只能分析/);await assert.rejects(service.download(local.id),/只能分析/);await assert.rejects(service.history(local.id),/没有 GitHub/);
});
test('GitHub projects missing from catalog get host metadata, local analysis and update checks',async t=>{
  let metadata=0,checked=0;const service=await fixture(t,{analyze:analysis,github:{async repository(id){metadata++;return {...repo,id,name:'other'};},async detail(){return {version:'release:v2',versionLabel:'v2',checkedAt:new Date().toISOString()};}}});
  await worktree(service,'other','https://github.com/test/other.git');service.local.check=async record=>{checked++;return {...record,ahead:0,behind:2,checkedAt:new Date().toISOString()};};
  service.visible=true;const result=await service.checkUpdates();assert.deepEqual(result.errors,[]);assert.equal(metadata,1);assert.equal(checked,1);
  const row=service.snapshot().repos[0];assert.equal(row.archived,true);assert.equal(row.category,'科研学术');assert.equal(row.update,true);assert.equal(row.download.git.behind,2);
});
async function updateFixture(t) {
  const service=await fixture(t);const path=await worktree(service,'test--repo','https://github.com/test/repo.git');
  const bare=join(service.root,'origin.git');await execute('git',['clone','--bare',path,bare]);const remote=join(service.root,'remote');await execute('git',['clone',bare,remote]);
  await writeFile(join(remote,'NEW.md'),'new version');await git(remote,'add','NEW.md');await git(remote,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','new release notes');await git(remote,'push','origin','main');
  service.local.runner=async(command,args,options)=>execute(command,args.map(a=>a==='https://github.com/test/repo.git'?bare:a),options);
  await service.scanDownloads(true);service.state.repos=[repo];return {service,path};
}
test('real Git check detects remote commit; pull fast-forwards and keeps hooks disabled',async t=>{
  const {service,path}=await updateFixture(t);let record=service.state.downloads[repo.id].git;
  const update=await service.local.check(record,repo.id);assert.equal(update.behind,1);assert.equal(update.ahead,0);
  const marker=join(service.root,'hook-ran');const hook=join(path,'.git','hooks','post-merge');await writeFile(hook,`#!/bin/sh\ntouch '${marker}'\n`);await chmod(hook,0o755);
  await service.gitOperation(repo.id,'pull');assert.equal(await readFile(join(path,'NEW.md'),'utf8'),'new version');
  assert.equal((await service.local.check(service.state.downloads[repo.id].git,repo.id)).behind,0);await assert.rejects(readFile(marker));
});
test('Git pull refuses dirty, divergent and detached worktrees without losing local data',async t=>{
  const {service,path}=await updateFixture(t);const original=await git(path,'rev-parse','HEAD');
  await writeFile(join(path,'README.md'),'uncommitted local edits');await assert.rejects(service.gitOperation(repo.id,'pull'),/本地修改/);
  assert.equal(await git(path,'rev-parse','HEAD'),original);assert.equal(await readFile(join(path,'README.md'),'utf8'),'uncommitted local edits');
  await git(path,'add','README.md');await git(path,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','local divergence');
  const local=await git(path,'rev-parse','HEAD');await assert.rejects(service.gitOperation(repo.id,'pull'),/Git 操作失败/);assert.equal(await git(path,'rev-parse','HEAD'),local);
  await git(path,'checkout','--detach');await assert.rejects(service.gitOperation(repo.id,'pull'),/切换/);
});
test('failed clone cleans staging directory and never marks a project downloaded',async t=>{
  const service=await fixture(t);service.state.repos=[repo];service.local.runner=async()=>{throw Object.assign(new Error('missing git'),{code:'ENOENT'});};
  await assert.rejects(service.gitOperation(repo.id,'clone'),/未安装 Git/);assert.equal(service.snapshot().downloadedCount,0);assert.deepEqual(await readdir(join(service.root,'downloads')),[]);
});
test('ranking reuses history between periods, deduplicates active work and stops at API limits',async t=>{
  let calls=0;const now=new Date();const cache=histories([repo],now);const service=await fixture(t,{github:{async starHistory(){calls++;return cache['test/repo:90'];}}});service.visible=true;service.state.repos=[repo];
  assert.throws(()=>service.startRanking('growth','day'),/周、月/);service.startRanking('growth','week');service.startRanking('growth','month');await service.rankingTask;assert.equal(calls,1);
  service.startRanking('growth','month');await service.rankingTask;assert.equal(calls,1);assert.equal(service.snapshot().overview.values[repo.id],30);
  service.state.repos.push({...repo,id:'other/missing'});service.github.starHistory=async()=>{throw Object.assign(new Error('quota'),{rateLimited:true});};
  service.startRanking('growth','week');await service.rankingTask;assert.equal(service.rankingJob.status,'partial');assert.equal(service.snapshot().overview.covered,1);
});
test('LAN access works without pairing and still blocks cross-site mutations',async t=>{
  const service=await fixture(t,{github:{async top(){throw new Error('offline');}}});const runtime=await startServer(service,{port:0});t.after(()=>runtime.close());
  assert.equal(runtime.server.address().address,'0.0.0.0');const owner=await (await fetch(runtime.url+'/api/state')).json();assert.equal(owner.network.pairCode,undefined);
  if(!runtime.lanUrls.length){t.diagnostic('No private IPv4 available; LAN transport check skipped.');return;}
  const url=runtime.lanUrls[0];const remote=await (await fetch(url+'/api/state')).json();assert.equal(typeof remote.token,'string');assert.equal(remote.network.pairCode,undefined);
  assert.equal((await fetch(url+'/api/analyze',{method:'POST'})).status,403);
  assert.equal((await fetch(url+'/api/pair?code=anything',{method:'POST',headers:{'X-WhatsNew-Token':remote.token}})).status,404);
  assert.equal((await fetch(url+'/api/analyze',{method:'POST',headers:{'X-WhatsNew-Token':remote.token}})).status,202);await service.analysisTask;
  assert.equal((await fetch(url+'/api/analyze',{method:'POST',headers:{'X-WhatsNew-Token':remote.token,Origin:'https://evil.invalid'}})).status,403);
  const invalidHost = await new Promise((resolve,reject)=>{const req=request(url+'/api/state',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(invalidHost,403);
});

test('failed release API does not prevent Git branch update checks',async t=>{
  const service=await fixture(t,{github:{async detail(){throw Object.assign(new Error('quota'),{rateLimited:true});}}});
  await worktree(service,'test--repo','https://github.com/test/repo.git');service.state.repos=[repo];service.local.check=async r=>({...r,ahead:0,behind:1});
  const result=await service.checkUpdates();assert.equal(result.errors.length,1);assert.equal(result.count,1);assert.equal(service.state.downloads[repo.id].git.behind,1);
});
test('directory scan recognizes dot-prefixed Git projects and skips symlinked README data',async t=>{
  const service=await fixture(t);const path=await worktree(service,'.local-repo');
  await rm(join(path,'README.md'));await symlink(join(service.root,'.runtime','state.json'),join(path,'README.md'));
  await service.save();await service.scanDownloads(true);assert.equal(service.snapshot().downloadedCount,1);
  const content=await service.local.content(path);assert.equal(content.text,'');
});

test('newly created repositories get verified pre-creation zeroes, with later missing days still unknown',()=>{
  const now=new Date('2026-10-13T09:00:00Z');const fresh={...repo,createdAt:'2026-10-11T08:00:00Z'};
  const history={[`${repo.id}:90`]:{metric:'daily-new-stars',to:'2026-10-13',fetchedAt:now.toISOString(),points:[{date:'2026-10-11',stars:2},{date:'2026-10-12',stars:3}]}};
  const result=calculateOverview([fresh],history,{period:'month',now});assert.equal(result.complete,true);assert.equal(result.values[repo.id],5);assert.equal(result.trend[0].stars,0);
  history[`${repo.id}:90`].points.pop();assert.equal(calculateOverview([fresh],history,{period:'month',now}).complete,false);
});
