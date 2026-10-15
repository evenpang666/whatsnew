import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { collectUsage } from './usage.js';
import { IncompleteSubmissionError } from './contracts.js';

export async function runStructuredAgent(ctx, { skill, prompt, tools, complete, missing, signal, maxTokens = 10000, timeoutMs = 240000, onUsage = async () => {}, pricing, modelSelection }) {
  await ctx.get('loader')?.await(); signal.throwIfAborted();
  const instructions = await readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
  const selection = modelSelection ? await modelSelection() : ctx.agentDefaultModel.currentSelection();
  const handle = await ctx.agents.create({ sessionId: `whatsnew-${skill}-${randomUUID()}`, meta: { cwd: process.cwd() }, agentOptions: { ...selection, maxTokens }, signal,
    setup(agentCtx) {
      agentCtx.tools.restrict({ allow: [] }); agentCtx.tools.presentAs('native');
      for (const tool of tools) agentCtx.tools.register({ ...tool, output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] } });
    }
  });
  const { agent } = handle; let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; agent.cancel(); }, timeoutMs);
  const abort = () => agent.cancel(); signal.addEventListener('abort', abort, { once: true });
  try {
    await agent.whenIdle();
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      if (timedOut) throw new Error('dsh 请求超时，已通过的项目保留，可继续处理。');
      const first = agent.session.seq;
      const task = attempt === 0 ? `必须应用以下 Skill 约束：\n${instructions}\n\n${prompt}` : `尚未完成工具提交。只补交以下缺失或校验未通过的部分：${missing()}。已 accepted 的产物保持不变。必须调用对应提交工具；不能以文本 JSON 代替。按工具反馈更正，最后再检查完整性。`;
      agent.followup(Object.freeze({ id: randomUUID(), role: 'user', source: { kind: 'user' }, content: [Object.freeze({ type: 'text', text: task })] }));
      await agent.whenIdle(); signal.throwIfAborted();
      if (complete()) return;
      let reason;
      for (let seq = first; seq < agent.session.seq; seq++) { const event = agent.session.eventAt(seq); if (event?.type === 'turn/end') reason = event.data.reason; }
      if (reason?.kind === 'error') throw new Error(reason.error?.message || 'dsh 请求失败。');
    }
    throw new IncompleteSubmissionError(`dsh 仍未提交完整结果：${missing()}。已通过的结果已保存，可继续处理。`);
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    try { await onUsage(await collectUsage(agent.session, selection, { pricing })); }
    finally { try { await ctx.sessions.flush(agent.session); } finally { await handle.dispose(); } }
  }
}
