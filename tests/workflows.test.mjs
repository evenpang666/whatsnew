import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeAnalyzer, makeInspirer } from '../src/analyzer.js';
import { validateProjectAnalysis, validateInspiration } from '../src/contracts.js';
import { makeProjectBuilder, validateProjectFile, PROJECT_FILES } from '../src/project-builder.js';
import { WhatsNewService } from '../src/service.js';
import { createProjectZip } from '../src/zip.js';

const signal = () => new AbortController().signal;
const repo = id => ({ id, name: id.split('/')[1], owner: id.split('/')[0], description: 'A local research workflow organizer.', topics: ['research','workflow'], readme: 'Organize experiments locally. Requires Node.js.', stars: 40000, branch: 'main' });
const analysis = r => ({id:r.id,summary:'在本地整理实验与研究工作流程。',category:'科研学术',tags:['实验管理','研究流程'],audience:'管理实验记录的科研人员',categoryReason:'核心用途是组织科研实验和研究工作流程，故归入科研学术。',capabilities:[{text:'本地组织实验记录',source:'readme',quote:'Organize experiments locally.'}],limitations:[{text:'需要 Node.js 运行环境',source:'readme',quote:'Requires Node.js.'}]});
const idea = repos => ({title:'实验灵感工作台',summary:'帮助科研人员把开源工具能力与本地实验计划联系起来的轻量网页工作台。',problem:'需求假设：科研人员需要在多个开源工具之间整理实验步骤与适用场景；这一痛点尚未经过用户验证，应先访谈确认。',audience:'需要整理实验方案与工具清单的科研人员',differentiation:'把工具选择、实验步骤和本地记录放在一个简单工作流中，先解决可执行的小范围需求。',evidence:repos.slice(0,3).map(r=>({id:r.id,source:'description',quote:r.description,observation:'该项目提供本地研究工作流整理能力。'})),features:['建立一份可编辑的实验步骤清单','把工具用途与实验步骤建立关联','将研究计划导出为可共享的文本'],validation:['访谈五位科研人员确认整理流程中的耗时环节','让三位目标用户完成一次完整计划编写并观察阻碍'],risks:['需求仍是假设，需要通过真实用户测试验证']});
function fakeContext(handler) {
  const prompts=[]; let created=0,disposed=0;
  const ctx={get:()=>({await:async()=>{}}),agentDefaultModel:{currentSelection:()=>({provider:'mock',model:'mock'})},sessions:{flush:async()=>{}},agents:{async create(options){
    const index=created++; const tools=new Map();const events=[];let pending=null,turn=0;
    options.setup({tools:{restrict:filter=>assert.deepEqual(filter,{allow:[]}),presentAs:mode=>assert.equal(mode,'native'),register:tool=>tools.set(tool.name,tool)}});
    const agent={session:{get seq(){return events.length;},eventAt:seq=>events[seq]},followup:message=>pending=message,cancel:()=>{},async whenIdle(){if(!pending)return;const prompt=pending.content[0].text;pending=null;prompts.push(prompt);await handler({tools,prompt,index,turn:++turn});events.push({type:'assistant/message',data:{message:{content:[{type:'text',text:'[{"broken":"missing closing brace"'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}});}};
    return {agent,dispose:async()=>disposed++};
  }}};
  return {ctx,prompts,get disposed(){return disposed;}};
}
const execute = (tools,name,args) => tools.get(name).execute(args,{signal:signal()});
test('truncated final JSON cannot invalidate accepted tool submissions; only missing projects are repaired',async()=>{
  const repos=[repo('test/one'),repo('test/two')];const accepted=[];
  const mock=fakeContext(async({tools,turn})=>{await execute(tools,'submit_project_analysis',analysis(repos[turn===1?0:1]));});
  const results=await makeAnalyzer(mock.ctx)(repos,signal(),{onResult:async row=>accepted.push(row.id)});
  assert.deepEqual(accepted,['test/one','test/two']);assert.equal(results.length,2);
  assert.match(mock.prompts[1],/test\/two/);assert.doesNotMatch(mock.prompts[1],/test\/one/);assert.equal(mock.disposed,1);
});
test('repair has a bounded stop and exposes validated partial results',async()=>{
  const repos=[repo('test/one'),repo('test/two')];const mock=fakeContext(async({tools,turn})=>{if(turn===1)await execute(tools,'submit_project_analysis',analysis(repos[0]));});
  await assert.rejects(makeAnalyzer(mock.ctx)(repos,signal()),error=>error.partialResults.length===1&&error.message.includes('test/two'));
  assert.equal(mock.prompts.length,3);assert.equal(mock.disposed,1);
});
test('per-project contract rejects invented evidence, wrong categories and missing capabilities',()=>{
  const r=repo('test/one');assert.equal(validateProjectAnalysis(analysis(r),r).analysisVersion,2);
  assert.throws(()=>validateProjectAnalysis({...analysis(r),capabilities:[{text:'完全不存在的能力',source:'readme',quote:'Invented quotation'}]},r),/不包含/);
  assert.throws(()=>validateProjectAnalysis({...analysis(r),category:'随意分类'},r));
  assert.throws(()=>validateProjectAnalysis({...analysis(r),capabilities:[]},r));
});
test('empty repository content is reported as insufficient rather than classified from a guess',()=>{
  const r={...repo('test/empty'),description:'',readme:'',topics:[]};
  assert.throws(()=>validateProjectAnalysis({...analysis(r),capabilities:[],limitations:[]},r),/信息不足/);
  assert.equal(validateProjectAnalysis({...analysis(r),category:'其他',summary:'信息不足，尚无法确认这个项目的主要用途。',audience:'信息不足，目标用户不明确',capabilities:[],limitations:[]},r).category,'其他');
});
test('failed persistence never marks a project accepted or discards its original README',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whatsnew-save-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const r=repo('test/one');const mock=fakeContext(async({tools})=>execute(tools,'submit_project_analysis',analysis(r)));
  const service=new WhatsNewService({root,github:{readme:async()=>({text:'Organize experiments locally. Requires Node.js.',source:'README'})},analyze:makeAnalyzer(mock.ctx)});await service.init();service.state.repos=[r];
  service.save=async()=>{throw new Error('disk full');};service.startAnalysis(true);await service.analysisTask;
  assert.equal(service.job.status,'error');assert.equal(service.job.progress,0);assert.equal(service.state.repos[0].analysisVersion,undefined);assert.equal(service.state.repos[0].readme,'Organize experiments locally. Requires Node.js.');
});
test('partial submissions persist immediately and retry skips accepted repositories',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whatsnew-partial-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repos=[repo('test/one'),repo('test/two')];
  const mock=fakeContext(async({tools,index,turn})=>{if(index===0&&turn===1)await execute(tools,'submit_project_analysis',analysis(repos[0]));if(index===1)await execute(tools,'submit_project_analysis',analysis(repos[1]));});
  const service=new WhatsNewService({root,github:{top:async()=>repos,readme:async()=>({text:'Organize experiments locally. Requires Node.js.',source:'README'})},analyze:makeAnalyzer(mock.ctx)});await service.init();
  service.startAnalysis();await service.analysisTask;assert.equal(service.job.status,'partial');assert.equal(service.job.progress,1);
  const saved=JSON.parse(await readFile(service.statePath,'utf8'));assert.equal(saved.repos[0].analysisVersion,2);assert.equal(saved.repos[1].analyzed,undefined);
  service.startAnalysis(true);await service.analysisTask;assert.equal(service.job.status,'complete');assert.equal(service.job.progress,2);
  assert.doesNotMatch(mock.prompts.at(-1),/"id":"test\/one"/);
});
test('inspiration requires all 100 strict analyses and verifiable distinct evidence',()=>{
  const repos=Array.from({length:100},(_,i)=>{const r=repo(`test/repo${i}`);return {...r,...validateProjectAnalysis(analysis(r),r)};});
  assert.equal(validateInspiration(idea(repos),repos).evidence.length,3);
  assert.throws(()=>validateInspiration(idea(repos),repos.slice(0,99)),/100/);
  assert.throws(()=>validateInspiration({...idea(repos),evidence:idea(repos).evidence.map(e=>({...e,quote:'unverified source'}))},repos),/原文/);
});
test('inspiration agent receives all 100 analyses and accepts only its structured evidence submission',async()=>{
  const repos=Array.from({length:100},(_,i)=>{const r=repo(`test/repo${i}`);return {...r,...validateProjectAnalysis(analysis(r),r)};});
  const mock=fakeContext(async({tools,prompt})=>{const inputs=JSON.parse(prompt.split('\n').at(-1));assert.equal(inputs.length,100);assert.ok(inputs.every(r=>r.capabilities.length&&r.readme.includes('Organize experiments locally.')));await execute(tools,'submit_inspiration',idea(inputs));});
  const result=await makeInspirer(mock.ctx)(repos,signal());assert.equal(result.title,'实验灵感工作台');assert.equal(mock.prompts.length,1);
});
test('completed catalog waits for manual inspiration; build runs only on explicit action',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whatsnew-idea-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repos=Array.from({length:100},(_,i)=>{const r=repo(`test/repo${i}`);return {...r,...validateProjectAnalysis(analysis(r),r)};});let inspires=0,builds=0;
  const service=new WhatsNewService({root,github:{},inspire:async all=>{inspires++;return validateInspiration(idea(all),all);},buildProject:async(_idea,path)=>{builds++;return {path,files:PROJECT_FILES};}});await service.init();service.state.repos=repos;
  assert.throws(()=>service.startInspiration(),/100/);
  service.startAnalysis(true);await service.analysisTask;assert.equal(inspires,0);assert.equal(builds,0);assert.equal(service.inspirationJob.status,'idle');
  service.startInspiration();await service.inspirationTask;assert.equal(inspires,1);assert.equal(service.inspirationJob.status,'complete');
  service.startInspiration();assert.equal(inspires,1);
  service.startImplementation();await service.implementationTask;assert.equal(builds,1);assert.equal(service.implementationJob.status,'complete');
  service.startImplementation();assert.equal(builds,1);assert.ok(service.state.implementation.path.startsWith(join(root,'generated-projects')));
});
test('inspiration failure does not turn a completed catalog into failed analysis',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whatsnew-idea-fail-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const service=new WhatsNewService({root,github:{},inspire:async()=>{throw new Error('model offline');}});await service.init();service.state.repos=Array.from({length:100},(_,i)=>({...repo(`test/repo${i}`),analyzed:true,analysisVersion:2}));
  service.startAnalysis(true);await service.analysisTask;assert.equal(service.job.status,'complete');assert.equal(service.inspirationJob.status,'idle');service.startInspiration();await service.inspirationTask;assert.equal(service.inspirationJob.status,'error');assert.equal(service.state.inspiration,null);
});
test('project writer confines paths and refuses incomplete package JSON or execution hooks',()=>{
  assert.throws(()=>validateProjectFile('../src/server.js','malicious'),/路径/);
  assert.throws(()=>validateProjectFile('package.json','{"scripts":'),/JSON/);
  assert.throws(()=>validateProjectFile('package.json',JSON.stringify({type:'module',scripts:{start:'node server.mjs',postinstall:'echo unsafe'}})),/仅允许/);
});
test('project builder checks required files and syntax without executing generated code',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whatsnew-build-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const contents={'package.json':JSON.stringify({type:'module',scripts:{start:'node server.mjs'}}),'README.md':'运行 npm start。','server.mjs':'throw new Error("must not run generated code");','public/index.html':'<!doctype html><html lang="zh-CN"><title>MVP</title></html>','public/app.js':'const ready = true;','public/style.css':'body { color: black; }'};
  const mock=fakeContext(async({tools})=>{for(const path of PROJECT_FILES)await execute(tools,'write_project_file',{path,content:contents[path]});await execute(tools,'finish_project',{});});
  const result=await makeProjectBuilder(mock.ctx)({},root,signal());assert.equal(result.files.length,6);assert.equal(await readFile(join(root,'server.mjs'),'utf8'),contents['server.mjs']);
});
test('generated source archive is a valid ZIP with intact contents',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whatsnew-zip-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=join(root,'source.zip');
  await writeFile(file,createProjectZip([{name:'README.md',content:Buffer.from('你好，MVP')},{name:'public/app.js',content:Buffer.from('const ready = true;')} ]));
  const result=spawnSync('python3',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("project/README.md").decode()=="你好，MVP"; assert len(z.namelist())==2',file]);assert.equal(result.status,0,result.stderr.toString());
});
