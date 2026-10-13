import { CATEGORIES } from './github.js';
export const ANALYSIS_VERSION = 2;
export class IncompleteSubmissionError extends Error {
  constructor(message, partialResults = []) { super(message); this.name = 'IncompleteSubmissionError'; this.partialResults = partialResults; }
}
const text = (value, label, min, max) => { if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new Error(`${label}需要 ${min}–${max} 字`); return value.trim(); };
const list = (value, label, min, max, itemMin = 2, itemMax = 180) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}需要 ${min}–${max} 项`);
  const values = value.map(v => text(v, label, itemMin, itemMax));
  if (new Set(values).size !== values.length) throw new Error(`${label}不能重复`); return values;
};
export function sourceText(repo, field) {
  if (field === 'topics') return (repo.topics || []).join('\n');
  if (field === 'description' || field === 'readme') return repo[field] || '';
  throw new Error('证据字段必须为 description、topics 或 readme');
}
function claim(value, repo) {
  const output = { text: text(value?.text, '能力或限制', 3, 160), source: value?.source, quote: text(value?.quote, '原文引用', 2, 180) };
  if (!sourceText(repo, output.source).includes(output.quote)) throw new Error(`${repo.id} 的 ${output.source} 不包含所提交的原文引用`);
  return output;
}
export function validateProjectAnalysis(value, repo) {
  if (!value || value.id !== repo.id) throw new Error('项目 ID 不在本批待处理列表');
  if (!CATEGORIES.includes(value.category)) throw new Error('分类不在允许的类别中');
  const hasContent = Boolean(repo.description || repo.readme || repo.topics?.length);
  if (!hasContent && (value.category !== '其他' || !value.summary?.includes('信息不足') || !value.audience?.includes('信息不足'))) throw new Error('没有可用内容时必须归为其他，并在简介和受众中明确标注信息不足');
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 4 || (hasContent && !value.capabilities.length)) throw new Error('有内容的项目需要 1–4 条有证据的能力');
  if (!Array.isArray(value.limitations) || value.limitations.length > 3) throw new Error('明确限制需要 0–3 条');
  return { id: repo.id, summary: text(value.summary, '简介', 3, 80), category: value.category, tags: list(value.tags, '标签', 2, 4, 2, 16), audience: text(value.audience, '受众', 3, 100), categoryReason: text(value.categoryReason, '分类依据', 10, 120), capabilities: value.capabilities.map(c => claim(c, repo)), limitations: value.limitations.map(c => claim(c, repo)), analyzed: true, analysisVersion: ANALYSIS_VERSION, analysisSource: 'dsh Agent · whatsnew-analyze Skill' };
}
export function validateInspiration(value, repos) {
  if (repos.length !== 100 || new Set(repos.map(r => r.id)).size !== 100 || repos.some(r => !r.analyzed || r.analysisVersion !== ANALYSIS_VERSION)) throw new Error('灵感需要 100 个通过分析契约的项目');
  if (!Array.isArray(value?.evidence) || value.evidence.length < 3 || value.evidence.length > 6) throw new Error('灵感需引用 3–6 个项目');
  const ids = new Set();
  const evidence = value.evidence.map(e => {
    const repo = repos.find(r => r.id === e.id);
    if (!repo || ids.has(e.id)) throw new Error('灵感证据 ID 无效或重复'); ids.add(e.id);
    const quote = text(e.quote, '灵感引用', 2, 180);
    if (!sourceText(repo, e.source).includes(quote)) throw new Error(`灵感引用不在 ${repo.id} 的原文中`);
    return { id: e.id, observation: text(e.observation, '项目观察', 5, 200), source: e.source, quote };
  });
  return { title: text(value.title, '项目名', 3, 40), summary: text(value.summary, '项目简介', 20, 200), problem: text(value.problem, '现有问题', 30, 500), audience: text(value.audience, '目标用户', 5, 120), differentiation: text(value.differentiation, '差异', 20, 300), evidence, features: list(value.features, 'MVP 功能', 3, 5, 10, 150), validation: list(value.validation, '验证方法', 2, 4, 10, 180), risks: list(value.risks, '风险', 1, 4, 10, 180) };
}
export const analysisParameters = { type: 'object', properties: {
  id: { type: 'string' }, summary: { type: 'string' }, category: { type: 'string', enum: CATEGORIES }, tags: { type: 'array', items: { type: 'string' } }, audience: { type: 'string' }, categoryReason: { type: 'string' },
  capabilities: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, source: { type: 'string', enum: ['description','topics','readme'] }, quote: { type: 'string' } }, required: ['text','source','quote'], additionalProperties: false } },
  limitations: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, source: { type: 'string', enum: ['description','topics','readme'] }, quote: { type: 'string' } }, required: ['text','source','quote'], additionalProperties: false } }
}, required: ['id','summary','category','tags','audience','categoryReason','capabilities','limitations'], additionalProperties: false };
export const inspirationParameters = { type: 'object', properties: {
  title: { type: 'string' }, summary: { type: 'string' }, problem: { type: 'string' }, audience: { type: 'string' }, differentiation: { type: 'string' },
  evidence: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, observation: { type: 'string' }, source: { type: 'string', enum: ['description','topics','readme'] }, quote: { type: 'string' } }, required: ['id','observation','source','quote'], additionalProperties: false } },
  features: { type: 'array', items: { type: 'string' } }, validation: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } }
}, required: ['title','summary','problem','audience','differentiation','evidence','features','validation','risks'], additionalProperties: false };
