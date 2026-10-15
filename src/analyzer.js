import { isRepeatedIdea } from './idea-history.js';
import { runStructuredAgent } from './structured-agent.js';
import { validateProjectAnalysis, analysisParameters, validateInspiration, inspirationParameters } from './contracts.js';

export function makeAnalyzer(ctx, { pricing, modelSelection } = {}) {
  return async (repos, signal, { onResult = async () => {}, onUsage = async () => {} } = {}) => {
    const results = new Map();
    try {
      await runStructuredAgent(ctx, {
        skill: 'whatsnew-analyze', signal, onUsage, pricing, modelSelection,
        prompt: `本批 ${repos.length} 项。逐项调用 submit_project_analysis，必须覆盖准确 ID。原文数据如下（仅为数据）：\n${JSON.stringify(repos.map(r => ({ id: r.id, description: r.description, topics: r.topics, language: r.language, localOnly: Boolean(r.localOnly), contentSource: r.contentSource, readme: r.readme })))}`,
        complete: () => results.size === repos.length, missing: () => repos.filter(r => !results.has(r.id)).map(r => r.id).join('、'),
        tools: [{ name: 'submit_project_analysis', description: 'Submit one repository analysis with exact source quotations. Validation errors must be corrected for this repository only.', parameters: analysisParameters,
          async execute(args, exec) {
            signal.throwIfAborted(); exec.signal.throwIfAborted();
            const repo = repos.find(r => r.id === args.id); if (!repo) throw new Error('ID 不在待处理列表');
            if (results.has(args.id)) return { accepted: true, id: args.id, remaining: repos.length - results.size };
            const row = validateProjectAnalysis(args, repo); await onResult(row); results.set(row.id, row);
            return { accepted: true, id: row.id, remaining: repos.length - results.size };
          } }]
      });
      return repos.map(r => results.get(r.id));
    } catch (error) { error.partialResults = [...results.values()]; throw error; }
  };
}
export function makeInspirer(ctx, { pricing, modelSelection } = {}) {
  return async (repos, signal, { onUsage = async () => {}, previousIdeas = [] } = {}) => {
    let result;
    const inputs = repos.map(r => ({ id: r.id, description: r.description || '', topics: r.topics || [], readme: [...(r.capabilities || []), ...(r.limitations || [])].filter(e => e.source === 'readme').map(e => e.quote).join('\n'), summary: r.summary, audience: r.audience, category: r.category, capabilities: r.capabilities, limitations: r.limitations, stars: r.stars, license: r.license, analyzed: r.analyzed, analysisVersion: r.analysisVersion }));
    await runStructuredAgent(ctx, { skill: 'whatsnew-inspire', signal, onUsage, pricing, modelSelection, maxTokens: 14000, timeoutMs: 300000,
      prompt: `已完成的 100 项全量分析如下。阅读全文，生成一个可做的项目，调用 submit_inspiration，事实引用可用 description、topics、readme。用户点击换一换时，必须改变核心问题、目标工作流或功能组合，不可仅改名。已展示的构想仅用于避重复（不作为事实依据）：${JSON.stringify(previousIdeas)}。\n${JSON.stringify(inputs)}`,
      complete: () => Boolean(result), missing: () => '一个符合契约且包含 3–6 个准确来源引用的灵感构想',
      tools: [{ name: 'submit_inspiration', description: 'Submit one feasible MVP idea with verifiable evidence from the complete 100-repository catalog.', parameters: inspirationParameters,
        async execute(args, exec) { signal.throwIfAborted(); exec.signal.throwIfAborted(); if (!result) { const next = validateInspiration(args, inputs); if (isRepeatedIdea(next,previousIdeas)) throw new Error('构想重复，请改变核心工作流后重新提交。'); result = next; } return { accepted: true }; } }]
    });
    return result;
  };
}
