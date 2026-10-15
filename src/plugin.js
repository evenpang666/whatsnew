import { quantityHistory } from './star-history.js';
import { WhatsNewService } from './service.js';
import { startServer } from './server.js';
import { makeAnalyzer, makeInspirer } from './analyzer.js';
import { makeProjectBuilder } from './project-builder.js';
import { independentModel } from './deepseek-model.js';

export const name = 'whatsnew';
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'tools', 'llm'];
export async function apply(ctx, config = {}) {
  const service = new WhatsNewService({ root: config.root || process.cwd() });
  const modelSelection = independentModel(ctx, service.deepseekCredentials);
  service.analyze = makeAnalyzer(ctx, { pricing: config.pricing, modelSelection });
  service.inspire = makeInspirer(ctx, { pricing: config.pricing, modelSelection });
  service.buildProject = makeProjectBuilder(ctx, { modelSelection });
  await service.init();
  const runtime = await startServer(service, { port: config.port ?? 3210, host: config.host || '0.0.0.0' });
  console.log(`\n  WhatsNew · GitHub 开源雷达\n  ${runtime.url}\n`);
  for (const url of runtime.lanUrls) console.log(`  局域网访问：${url}`);
  ctx.on('dispose', () => runtime.close());
  const output = { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
  const register = (toolName, description, parameters, execute) => ctx.tools.register({ name: toolName, description, parameters, output, execute });
  register('whatsnew_history', 'Query historical daily new star counts from the official GitHub repository star history API. Independent of local analysis runs.', { type: 'object', properties: { id: { type: 'string' }, days: { anyOf:[{type:'integer',enum:[30,90,180,365]},{type:'string',enum:['all']}] }, metric:{type:'string',enum:['growth','total']} }, required: ['id'], additionalProperties: false }, async (args, exec) => {
    if (service.state.repos.some(r => r.id === args.id) || service.state.downloads[args.id]) return service.history(args.id, args.days ?? 90,false,exec.signal,args.metric || 'growth');
    const repo = (await service.github.top(exec.signal)).find(r => r.id === args.id);
    if (!repo) throw new Error('项目不在当前 Top 100 榜单。');
    if(args.metric === 'total') return quantityHistory(await service.github.starHistory(repo,'all',exec.signal),args.days ?? 90);
    return service.github.starHistory(repo, args.days ?? 90, exec.signal);
  });
  register('whatsnew_top', 'Read the GitHub public repository Top 100 ranked by total stars. Returns a real GitHub snapshot, not daily Trending.', { type: 'object', properties: {}, additionalProperties: false }, async (_args, exec) => service.github.top(exec.signal));
  register('whatsnew_project', 'Read live release notes, recent commits and release asset download counts for a repository in the WhatsNew catalog.', { type: 'object', properties: { id: { type: 'string', description: 'Exact owner/repo identifier from whatsnew_top.' } }, required: ['id'], additionalProperties: false }, async (args, exec) => {
    if (service.state.repos.some(r => r.id === args.id) || service.state.downloads[args.id]) return service.detail(args.id);
    const repo = (await service.github.top(exec.signal)).find(r => r.id === args.id);
    if (!repo) throw new Error('项目不在当前 Top 100 榜单。');
    return { ...repo, ...await service.github.detail(repo, exec.signal) };
  });
}
