import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let parserPromise;
const count = n => Number.isSafeInteger(n) && n >= 0;
export function emptyUsage() {
  return { sessions: 0, reportedTurns: 0, missingTurns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costMinUsd: 0, costMaxUsd: 0, pricingComplete: true, complete: true, models: [] };
}
async function nativeParser() {
  parserPromise ||= (async () => {
    try { const require = createRequire(await realpath(resolve(process.argv[1] || 'index.js'))); return (await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-token-meter/client')).href)).deriveTurnTokenUsage; }
    catch { return null; }
  })();
  return parserPromise;
}
// USD per million tokens, verified 2026-10-13 against the linked official page.
const priceSource = 'https://api-docs.deepseek.com/quick_start/pricing/';
export function referencePrice(model, override) {
  if (override && ['input', 'cacheRead', 'output'].every(k => Number.isFinite(override[k]) && override[k] >= 0)) return { low: override, high: override, source: '插件配置的 USD／百万 Token 单价' };
  if (['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model)) return { low: { input: .15, cacheRead: .003, output: .6 }, high: { input: .3, cacheRead: .006, output: 1.2 }, source: priceSource };
  if (model === 'deepseek-v4-pro') return { low: { input: .66, cacheRead: .022, output: 1.98 }, high: { input: 1.32, cacheRead: .044, output: 3.96 }, source: priceSource };
  return null;
}
function fallbackUsage(events) {
  // A lower bound only. Exact accounting is delegated to dsh's lifecycle fold.
  const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
  let samples = 0;
  for (const event of events) {
    if (!['assistant/message', 'assistant/attempt'].includes(event.type)) continue;
    const u = event.data.usage || [...(event.data.stream || [])].reverse().find(c => c.type === 'usage')?.usage;
    if (!u || !count(u.inputTokens) || !count(u.outputTokens)) continue;
    const sum = u.inputTokens + u.outputTokens + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
    if ((u.cacheReadTokens != null && !count(u.cacheReadTokens)) || (u.cacheWriteTokens != null && !count(u.cacheWriteTokens)) || (u.totalTokens != null && (!count(u.totalTokens) || u.totalTokens < sum))) continue;
    totals.uncachedInputTokens += u.inputTokens; totals.outputTokens += u.outputTokens;
    totals.cacheReadTokens += u.cacheReadTokens || 0; totals.cacheWriteTokens += u.cacheWriteTokens || 0; totals.totalTokens += u.totalTokens ?? sum; samples++;
  }
  return samples ? totals : null;
}
export async function collectUsage(session, selection, { deriveTurn, pricing } = {}) {
  const parser = deriveTurn || await nativeParser(), result = { ...emptyUsage(), sessions: 1 };
  let turn = [];
  const turns = [];
  for (let seq = 0; seq < session.seq; seq++) {
    const event = session.eventAt(seq); if (!event) continue;
    if (event.type === 'turn/start') { if (turn.length) turns.push(turn); turn = [event]; }
    else if (turn.length) { turn.push(event); if (event.type === 'turn/end') { turns.push(turn); turn = []; } }
    else if (['assistant/message', 'assistant/attempt'].includes(event.type)) turns.push([event]);
  }
  if (turn.length) turns.push(turn);
  for (const events of turns) {
    let exact;
    try { exact = parser?.(events); } catch {}
    const usage = exact || fallbackUsage(events);
    if (!exact) result.missingTurns++;
    if (!usage) continue;
    result.reportedTurns++;
    result.inputTokens += usage.uncachedInputTokens; result.outputTokens += usage.outputTokens;
    result.cacheReadTokens += usage.cacheReadTokens || 0; result.cacheWriteTokens += usage.cacheWriteTokens || 0; result.totalTokens += usage.totalTokens;
    const routes = usage.routes || [selection];
    const model = routes.length === 1 ? routes[0]?.model : null;
    if (model && !result.models.includes(model)) result.models.push(model);
    const rate = referencePrice(model, pricing);
    const accounted = usage.uncachedInputTokens + usage.outputTokens + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
    if (!rate || (usage.cacheWriteTokens && !Number.isFinite(rate.low.cacheWrite)) || accounted !== usage.totalTokens) { result.pricingComplete = false; continue; }
    const estimate = p => (usage.uncachedInputTokens * p.input + (usage.cacheReadTokens || 0) * p.cacheRead + (usage.cacheWriteTokens || 0) * (p.cacheWrite || 0) + usage.outputTokens * p.output) / 1e6;
    result.costMinUsd += estimate(rate.low); result.costMaxUsd += estimate(rate.high); result.priceSource = rate.source;
  }
  result.complete = result.missingTurns === 0 && result.reportedTurns > 0;
  if (!result.complete) result.pricingComplete = false;
  return result;
}
export function addUsage(total, usage) {
  for (const key of ['sessions', 'reportedTurns', 'missingTurns', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'costMinUsd', 'costMaxUsd']) total[key] += usage[key] || 0;
  total.complete &&= usage.complete; total.pricingComplete &&= usage.pricingComplete;
  total.models = [...new Set([...total.models, ...(usage.models || [])])]; if (usage.priceSource) total.priceSource = usage.priceSource;
  return total;
}
