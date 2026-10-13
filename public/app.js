const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = n => n == null ? '未提供' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('zh-CN');
const date = v => v ? new Date(v).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '—';
const fullDate = v => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—';
const categoryMeta = {
  '人工智能': ['spark', 'ai'], '开发工具': ['code', 'dev'], '科研学术': ['flask', 'research'], '摄影影像': ['camera', 'photo'],
  '艺术设计': ['palette', 'art'], '学习资源': ['book', 'learn'], '效率工具': ['bolt', 'tool'], '其他': ['grid', 'other']
};
let state = { repos: [], job: { status: 'idle' } }, view = 'explore', category = '', tag = '', search = '', sort = 'stars', selectedId = '', renderKey = '', fetching = false;
const downloading = new Set(); let toastTimer; let inspirationKey = ''; let trendDays = 90, trendMetric = 'growth', trendRequest = 0; let revealed = false, rankingMode = 'stars', rankingPeriod = 'week', overviewKey = '', networkKey = '';
let catalogPage = 1, catalogPageKey = '', paginationKey = '';
const PAGE_SIZE = 9;
const pendingOperations = new Map(), clientErrors = new Map();
let chartWindow, zoomState = null, zoomPeriod = '', comparisonContext = null;
import('/chart-window.js').then(module => { chartWindow = module; overviewKey = ''; renderOverview(); }).catch(() => toast('图表缩放组件加载失败，请刷新页面。'));
let inspirationRequested = false; const focusedSeries = new Set();
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(state.token ? { 'X-WhatsNew-Token': state.token } : {}), ...options.headers } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败，请重试。'); return data;
}
function applyView(next) {
  view = next; category = ''; tag = ''; search = ''; $('search-input').value = '';
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); });
  const title = { explore: '探索发现', downloaded: '已下载', updates: '版本更新' }[view];
  $('breadcrumb-title').textContent = title;
  $('catalog-title').firstChild.textContent = { explore: '热门项目', downloaded: '我的下载', updates: '新版本动态' }[view];
  $('catalog-subtitle').textContent = { explore: '按 GitHub Star 总数排序，发现被世界认可的好工具', downloaded: '源码已保存到本地，随时回来继续探索', updates: '比较已下载版本，查看 Release 简介与最近提交' }[view];
  render();
}
function filtered() {
  if (!revealed && view === 'explore') return [];
  const overview = state.overviews?.[rankingPeriod] || state.overview;
  return state.repos.map(r => ({ ...r, growth: overview?.values[r.id] ?? null, growthRank: overview?.ranks[r.id] ?? null })).filter(r => (view !== 'explore' || !r.archived) && (view !== 'downloaded' || r.download) && (view !== 'updates' || r.update) && (!category || r.category === category) && (!tag || r.tags?.includes(tag)) && (!search || `${r.id} ${r.summary || r.description} ${r.category || ''} ${(r.tags || []).join(' ')} ${r.language || ''}`.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'updated' ? Date.parse(b.pushedAt) - Date.parse(a.pushedAt) : sort === 'growth' ? (b.growth ?? -1) - (a.growth ?? -1) || (b.stars ?? -1) - (a.stars ?? -1) : (b.stars ?? -1) - (a.stars ?? -1));
}
function render() {
  const allRepos = filtered();
  const contextKey = JSON.stringify([view,category,tag,search,sort,rankingMode,rankingPeriod]);
  if (catalogPageKey !== contextKey) { catalogPage = 1; catalogPageKey = contextKey; }
  const pages = Math.max(1,Math.ceil(allRepos.length/PAGE_SIZE));
  catalogPage = Math.max(1,Math.min(catalogPage,pages));
  const repos = view === 'explore' ? allRepos.slice((catalogPage-1)*PAGE_SIZE,catalogPage*PAGE_SIZE) : allRepos;
  renderPagination(allRepos.length,pages);
  const analyzed = (revealed ? state.repos : []).filter(r => r.analyzed && (state.demo || r.analysisVersion === 2));
  $('all-count').textContent = (revealed ? state.repos : []).filter(r => !r.archived).length;
  $('download-count').textContent = state.downloadedCount || 0; $('update-count').textContent = state.updatesCount || 0;
  $('stat-projects').textContent = analyzed.filter(r => !r.archived).length || '—';
  $('stat-categories').textContent = new Set(analyzed.map(r => r.category)).size || '—';
  $('stat-stars').textContent = analyzed.length ? number(analyzed.filter(r => !r.archived).reduce((n, r) => n + r.stars, 0)) : '—';
  $('stat-time').textContent = revealed && state.analyzedAt ? date(state.analyzedAt) : '尚未分析';
  $('stat-time').title = fullDate(state.analyzedAt);
  $('analysis-timestamp').hidden = !state.analyzedAt;
  $('analysis-timestamp').textContent = `上次分析：${fullDate(state.analyzedAt)} · 已保存到本地${state.job.status === 'running' ? ' · 正在更新' : ''}`;
  const auth = state.githubAuth;
  $('github-auth-status').textContent = auth?.error || (auth?.enabled ? `已启用 · ${auth.source}` : '未配置 Token · 匿名访问');
  $('remove-github-token').disabled = auth?.source !== 'config/github.token';
  $('github-token-form').hidden = state.demo;
  $('demo-banner').hidden = !state.demo;
  $('categories').innerHTML = Object.entries(categoryMeta).map(([name, [glyph]]) => `<button class="category-button ${category === name ? 'selected' : ''}" data-category="${escape(name)}" aria-label="${escape(name)}" aria-pressed="${category === name}">${icon(glyph)}<span>${escape(name)}</span><span>${revealed ? state.repos.filter(r => r.category === name).length : 0}</span></button>`).join('');
  const filters = { all: '', ai: '人工智能', research: '科研学术', design: '艺术设计' };
  document.querySelectorAll('[data-filter]').forEach(b => { const active = filters[b.dataset.filter] === category; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', active); });
  $('result-count').textContent = allRepos.length;
  $('active-filter').hidden = !tag; $('filter-label').textContent = `标签：${tag}`;
  const key = JSON.stringify([repos, [...downloading], [...clientErrors], view, sort, rankingPeriod, catalogPage]);
  if (key !== renderKey) {
    const grid = $('project-grid');
    const existing = new Map([...grid.children].map(node => [node.dataset.repoId, node]));
    const wanted = new Set(repos.map(r => r.id));
    for (const [id,node] of existing) if (!wanted.has(id)) node.remove();
    repos.forEach((r,index) => {
      const signature = JSON.stringify([r.id,r.analyzed,r.summary,r.category,r.tags,r.stars,r.rank,r.archived,r.owner,r.language,r.download,r.growth,r.growthRank,r.localOnly,r.update,sort,operationBusy(r)]);
      let node = existing.get(r.id);
      if (!node || node.renderSignature !== signature) {
        const template = document.createElement('template'); template.innerHTML = card(r);
        const replacement = template.content.firstElementChild; replacement.renderSignature = signature;
        if (node?.parentNode) node.replaceWith(replacement); node = replacement;
      }
      const operationSlot = node.querySelector('.card-operation'), operationHTML = operationMarkup(r);
      if (operationSlot.innerHTML !== operationHTML) operationSlot.innerHTML = operationHTML;
      if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] || null);
    });
    renderKey = key;
  }
  $('empty-state').hidden = repos.length > 0;
  if (!repos.length) {
    const fresh = view === 'explore' && (!revealed || !state.repos.some(r=>!r.archived));
    $('empty-title').textContent = fresh ? '你的下一次发现，从这里开始' : view === 'downloaded' ? '还没有下载的项目' : view === 'updates' ? '这里等待下一次更新' : '暂时没有匹配的项目';
    $('empty-description').textContent = fresh ? '点击「一键分析」，让 dsh 为你读懂 GitHub 热门前 100 项目。' : view === 'downloaded' ? '找到喜欢的项目，点击下载后就会出现在这里。' : view === 'updates' ? '点击「检查更新」获取已下载项目的最新版本。' : '试试其他关键词、兴趣分类或标签。';
    $('empty-action').textContent = fresh ? '开始探索 →' : view === 'updates' ? '检查更新 →' : '查看全部项目 →';
  }
  $('inspiration-panel').hidden = !revealed;
  if (revealed) renderInspiration();
  renderOverview(); renderNetwork();
  $('display-controls').hidden = !revealed;
  document.querySelectorAll('[data-display-mode]').forEach(b => { b.classList.toggle('selected', b.dataset.displayMode === rankingMode); b.setAttribute('aria-pressed', b.dataset.displayMode === rankingMode); });
  $('display-period').value = rankingPeriod;
  const ideaRunning = state.inspirationJob?.status === 'running';
  $('inspire-button').disabled = !state.inspirationReady || ideaRunning || state.implementationJob?.status === 'running' || !!state.inspiration;
  $('inspire-swap').hidden = !state.inspiration;
  $('inspire-swap').disabled = !state.inspirationReady || ideaRunning || state.implementationJob?.status === 'running';
  $('inspiration-run-status').hidden = !['running', 'error', 'cancelled'].includes(state.inspirationJob?.status);
  $('inspiration-run-status').textContent = state.inspirationJob?.message || '';
  $('inspire-button').textContent = ideaRunning ? '✦ 正在生成灵感…' : state.inspiration ? '✦ 灵感已生成' : '✦ 灵感乍现';
  $('analysis-cost').textContent = revealed ? usageLabel(state.usage?.analysis) : '100 个项目 · 累计与增星同时分析';
  $('inspiration-cost').textContent = usageLabel(state.usage?.inspiration, inspirationRequested ? '本次' : '最近一次');
  const billingTitle = u => u ? `未缓存输入 ${u.inputTokens || 0} · 缓存读取 ${u.cacheReadTokens || 0} · 缓存写入 ${u.cacheWriteTokens || 0} · 输出 ${u.outputTokens || 0} Token（含思考）。按 dsh 实际用量汇总，包含任务重试。费用单位 USD；${u.priceSource?.startsWith('https:') ? '参考 DeepSeek 官方峰谷报价（2026-10-13 核验）' : u.priceSource || '未知模型单价需在插件配置中提供'}，实际账单以接入平台为准。` : '';
  $('analysis-cost').title = billingTitle(state.usage?.analysis); $('inspiration-cost').title = billingTitle(state.usage?.inspiration);
  $('download-path').textContent = state.downloadPath || 'downloads/';
  $('local-status').hidden = !state.localJob?.message && !state.scanWarnings?.length;
  $('local-status').textContent = [state.localJob?.message, ...(state.scanWarnings || [])].filter(Boolean).join('；');
  if (view === 'explore' && revealed) $('catalog-subtitle').textContent = sort === 'growth' ? `累计 Star 前 100 内，按最近完整 ${rankingPeriod === 'week' ? '7' : '30'} 天新增 Star 排序；历史缺失项置于末尾` : '按 GitHub Star 总数排序，发现被世界认可的好工具';
  const job = state.job; const running = job.status === 'running';
  $('analysis-status').hidden = job.status === 'idle';
  $('analysis-status').classList.toggle('is-running', running);
  $('status-message').textContent = job.message || '';
  $('status-number').textContent = job.total && job.status !== 'idle' ? `${job.progress} / ${job.total}` : '';
  $('analysis-progress').value = job.progress || 0; $('analysis-progress').max = job.total || 100;
  $('cancel-button').hidden = !running;
  $('error-details').hidden = !job.errors?.length; $('errors').innerHTML = (job.errors || []).map(e => `<p>${escape(e)}</p>`).join('');
  $('analyze-button').disabled = revealed && (running || state.inspirationJob?.status === 'running' || state.implementationJob?.status === 'running');
  const retry = ['partial', 'error', 'cancelled'].includes(job.status) && state.repos.some(r => !r.analyzed || r.analysisVersion !== 2);
  $('analyze-button').innerHTML = `${icon(running ? 'refresh' : 'spark')}<span>${!revealed ? '一键分析' : running ? '正在分析' : retry ? '继续分析' : state.repos.length ? '重新分析' : '一键分析'}</span>${icon('arrow')}`;
  $('footer-status').textContent = state.demo ? '演示数据 · 可体验筛选与详情' : state.analyzedAt ? `数据采集于 ${fullDate(state.analyzedAt)} · 由 dsh 分析` : running ? 'dsh 正在整理项目内容…' : '等待首次分析';
}
function renderPagination(total, pages) {
  const nav = $('catalog-pagination'); nav.hidden = view !== 'explore' || total <= PAGE_SIZE;
  $('pagination-status').textContent = total ? `${(catalogPage-1)*PAGE_SIZE+1}–${Math.min(catalogPage*PAGE_SIZE,total)} / 共 ${total} 个项目` : '';
  const key = `${view}:${pages}:${catalogPage}`; if (paginationKey === key) return; paginationKey = key;
  const visible = Array.from({length:pages},(_,i)=>i+1).filter(page=>page===1||page===pages||Math.abs(page-catalogPage)<=1);
  const button = (page,label,disabled=false,current=false) => `<button type="button" data-catalog-page="${page}" ${disabled?'disabled':''} ${current?'aria-current="page"':''} aria-label="${escape(label)}" class="${current?'selected':''}">${escape(label.startsWith('第')?page:label)}</button>`;
  let previous = 0;
  $('pagination-buttons').innerHTML = button(catalogPage-1,'上一页',catalogPage===1)+visible.map(page=>{
    const gap = previous && page-previous>1 ? '<span class="pagination-ellipsis" aria-hidden="true">…</span>' : ''; previous=page;
    return gap+button(page,`第 ${page} 页`,false,page===catalogPage);
  }).join('')+button(catalogPage+1,'下一页',catalogPage===pages);
}
$('pagination-buttons').onclick = e => {
  const button=e.target.closest('[data-catalog-page]'); if (!button || button.disabled) return;
  catalogPage=Number(button.dataset.catalogPage); render();
  $('catalog-title').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  $('pagination-buttons').querySelector('[aria-current="page"]')?.focus({preventScroll:true});
};
function renderInspiration() {
  const idea = state.inspiration, job = state.inspirationJob || {status:'idle'}, build = state.implementationJob || {status:'idle'};
  const key = JSON.stringify([idea,job,build,state.implementation,state.inspirationReady,state.job.status,state.job.progress]);
  if (key === inspirationKey) return; inspirationKey = key;
  const container = $('inspiration-content');
  if (!idea) {
    container.innerHTML = `<div class="inspiration-empty"><span class="inspiration-spark ${job.status === 'running' ? 'pulse-icon' : ''}">✦</span><div><strong>${job.status === 'running' ? '一个新想法，正在成形' : job.status === 'error' ? '灵感生成暂未完成' : '好灵感，从读懂 100 个项目开始'}</strong><p>${escape(job.message || '项目分析完成并展示后，手动点击「灵感乍现」。')}</p></div>${job.status === 'running' ? '<button class="text-button" data-cancel-generation>停止生成</button>' : `<span class="inspiration-wait">${state.inspirationReady ? '准备就绪，点击上方按钮' : '等待完整分析'}</span>`}</div>`;
    return;
  }
  container.innerHTML = `<div class="idea-title-row"><h3>${escape(idea.title)}</h3><span class="idea-meta">${state.demo ? '示例灵感' : '基于 100 个项目'} · 生成于 ${fullDate(idea.generatedAt)}</span></div><p class="idea-summary">${escape(idea.summary)}</p><div class="idea-grid"><div><h4>现有问题</h4><p>${escape(idea.problem)}</p></div><div><h4>项目内容</h4><p><strong>目标用户：</strong>${escape(idea.audience)}</p><p>${escape(idea.differentiation)}</p></div></div><div class="idea-features">${(idea.features || []).map((f,i) => `<span><b>0${i+1}</b>${escape(f)}</span>`).join('')}</div><details class="idea-evidence"><summary>查看灵感依据与验证方法 · ${(idea.evidence || []).length} 个参考项目</summary><div>${(idea.evidence || []).map(e => `<div class="idea-source"><a href="https://github.com/${escape(e.id)}" target="_blank" rel="noopener noreferrer">${escape(e.id)} ↗</a><p>${escape(e.observation)}</p><blockquote>${escape(e.quote)}</blockquote></div>`).join('')}<h4>需要验证</h4><ul>${(idea.validation || []).map(v => `<li>${escape(v)}</li>`).join('')}</ul><h4>实施风险</h4><ul>${(idea.risks || []).map(v => `<li>${escape(v)}</li>`).join('')}</ul></div></details><div class="idea-actions"><div><strong>让灵感，变成第一个版本。</strong><span>点击后由 dsh 撰写本地 MVP 源码，保存在独立项目目录。</span></div><button class="button primary" data-implement ${state.demo || job.status === 'running' || state.job.status === 'running' || build.status === 'running' || state.implementation ? 'disabled' : ''}>${icon('spark')}${build.status === 'running' ? 'dsh 正在撰写…' : state.implementation ? '项目已撰写' : '要我帮你实现吗？'}${icon('arrow')}</button></div>${build.status !== 'idle' ? `<div class="implementation-status"><p>${escape(build.message || '')}${build.status === 'running' ? ` · ${build.progress || 0}/${build.total || 6} 文件` : ''}</p>${state.implementation ? `<p class="generated-path">${escape(state.implementation.path)}</p><span>${escape(state.implementation.checked)}</span><a class="button secondary" href="/api/implementation/archive">${icon('download')}下载新项目源码 ZIP</a><p>进入该目录运行 <code>npm start</code>。先阅读 README 了解 MVP 范围。</p>` : build.status === 'error' || build.status === 'cancelled' ? '<button class="text-button" data-implement>重新撰写</button>' : build.status === 'running' ? '<button class="text-button" data-cancel-generation>停止撰写</button>' : ''}</div>` : ''}`;
}
async function inspire() {
  try { await api('/api/inspire?refresh=1', {method:'POST'}); inspirationRequested = true; await refresh(); } catch(e) { toast(e.message); }
}
async function implement() {
  try { await api('/api/implement', {method:'POST'}); toast('dsh 正在将灵感写成一个本地 MVP 项目。'); await refresh(); } catch(e) { toast(e.message); }
}
function projectActions(r, busy = operationBusy(r)) {
  if (r.localOnly) return `<span class="local-only-note">${r.localKind === 'archive' ? '本地 ZIP · 文件记录' : r.localKind === 'folder' ? '本地目录 · 仅内容分析' : '本地 Git · 仅内容分析'}</span>`;
  const button = (action, label, disabled = false, title = '') => `<button class="download-button" data-repo-action="${action}" data-id="${escape(r.id)}" ${busy || disabled ? 'disabled' : ''} title="${escape(title)}">${label}</button>`;
  return r.download ? button('check', '检查更新') + button('zip', '下载最新 ZIP') + button('pull', '拉取项目', !r.download.git, r.download.git ? '仅快进更新，保留本地修改' : '请先在详情页克隆项目，ZIP 不支持拉取') : button('zip', '下载 ZIP') + button('clone', '克隆项目', false, '面向开发者：需要 Git');
}
function card(r) {
  const [glyph, tone] = categoryMeta[r.category] || categoryMeta['其他'];
  const monogram = ({ 'freeCodeCamp': 'f', 'vue': 'V', 'react': '⚛', 'tensorflow': 'tf', 'pytorch': 'pt', 'vscode': '⌘', 'obs-studio': '◉', 'blender': 'b', 'ollama': 'o', 'ComfyUI': 'C', 'awesome': 'a', 'excalidraw': 'e' })[r.name] || r.name.slice(0, 1).toUpperCase();
  const busy = operationBusy(r);
  return `<article data-repo-id="${escape(r.id)}" class="project-card ${r.analyzed ? '' : r.archived && r.download ? 'unanalysed-local-card' : 'pending-card'} ${r.update ? 'has-update' : ''}">${r.update ? '<span class="update-badge">发现新版本</span>' : ''}<div class="card-main" role="button" tabindex="0" data-project="${escape(r.id)}" aria-label="查看 ${escape(r.name)} 详情"><div class="card-top"><span class="repo-icon tone-${tone}">${escape(monogram)}</span><span class="rank">${r.localOnly ? (r.localKind === 'archive' ? '本地 ZIP' : r.localKind === 'folder' ? '本地目录' : '本地 Git') : r.archived ? '目录项目' : sort === 'growth' ? r.growthRank ? `↑ # ${r.growthRank}` : '历史缺失' : `# ${String(r.rank).padStart(2, '0')}`}</span></div><h3 class="card-name">${escape(r.name)}</h3><span class="card-owner">${escape(r.owner)} / ${escape(r.name)}</span><p class="card-description">${escape(r.analyzed ? r.summary : r.localKind === 'archive' ? '本地 ZIP 文件，尚未关联 GitHub 项目。' : r.archived && r.download ? '尚未分析，检查更新可补充简介与标签。' : '等待 dsh 分析简介与标签…')}</p><div class="card-tags">${(r.tags || []).slice(0, 3).map(t => `<button class="tag" data-tag="${escape(t)}">${escape(t)}</button>`).join('')}${!r.analyzed && r.localKind !== 'archive' ? '<span class="tag">尚未分析</span>' : ''}</div><div class="card-metrics"><span class="stars">${icon('star')}${r.localOnly ? "本地项目" : number(r.stars)}</span>${!r.localOnly && sort === "growth" ? `<span class="growth-metric">${r.growth == null ? "增星待查询" : `+ ${number(r.growth)} Star`}</span>` : ""}<span class="language"><span class="language-dot lang-${escape((r.language || '').replace(/[^A-Za-z]/g, ''))}"></span>${escape(r.language || '未标注语言')}</span></div></div><div class="card-footer"><span class="category-small">${icon(glyph)}${escape(r.category || (r.localKind === 'archive' ? '本地文件' : '待分类'))}${r.download ? '<small>✓ 已下载</small>' : ''}</span><div class="repo-actions">${projectActions(r, busy)}</div></div><div class="card-operation">${operationMarkup(r)}</div></article>`;
}
function operationBusy(r) { return downloading.has(r.id) || r.operation?.status === 'running'; }
function operationMarkup(r) {
  const pending = pendingOperations.get(r.id), remote = r.operation;
  const operation = pending && remote?.id === pending.previousId ? pending : remote || pending;
  const clientError = clientErrors.get(r.id);
  // A new server operation supersedes an error from an older attempt/device.
  const error = clientError && clientError.operationId === remote?.id ? clientError.message : operation?.error;
  const bytes = n => n >= 1048576 ? `${(n/1048576).toFixed(1)} MiB` : n >= 1024 ? `${(n/1024).toFixed(1)} KiB` : `${n || 0} B`;
  const label = operation?.type === 'zip' ? 'ZIP 下载' : operation?.type === 'pull' ? 'Git 拉取' : 'Git 克隆';
  const progress = operation?.status === 'running' || operation?.status === 'success' ? `<div class="operation-progress"><div><span>${escape(label)} · ${escape(operation.phase)}</span><small>${operation.type === 'zip' ? bytes(operation.loaded) + (operation.total ? ' / '+bytes(operation.total) : '') : operation.objects != null && operation.percent != null ? `${operation.objects}/${operation.objectTotal} 对象` : ''}${operation.percent != null ? ` · ${operation.percent}%` : ''}</small></div><progress max="100" ${operation.percent == null ? '' : `value="${operation.percent}"`} aria-label="${escape(label+' · '+operation.phase)}"></progress></div>` : '';
  return progress + (error ? `<p class="operation-error" role="status">${escape(error)}</p>` : '');
}
function startClientOperation(id, type) {
  const previousId = state.repos.find(r => r.id === id)?.operation?.id;
  pendingOperations.set(id, { previousId, type, status: 'running', phase: '准备操作…', loaded: 0, percent: null });
  clientErrors.delete(id); downloading.add(id); render();
}
async function operationFailed(id, error) {
  await refresh();
  clientErrors.set(id, { message: error.message, operationId: state.repos.find(r => r.id === id)?.operation?.id });
  toast(error.message);
}
async function refresh() {
  if (fetching) return; fetching = true;
  try { state = await api('/api/state'); revealed ||= state.visible; render(); }
  catch (e) { $('footer-status').textContent = '本地服务连接失败，请检查启动终端。'; }
  finally { fetching = false; }
}
async function analyze() {
  try {
    if (state.job.status === 'running' || state.inspirationJob?.status === 'running' || state.implementationJob?.status === 'running') { revealed = true; render(); return; }
    const resume = ['partial', 'error', 'cancelled'].includes(state.job.status) && state.repos.some(r => !r.analyzed || r.analysisVersion !== 2);
    await api(`/api/analyze?resume=${resume ? 1 : 0}`, { method: 'POST' });
    revealed = true; catalogPage = 1; zoomState = null; focusedSeries.clear(); sort = rankingMode; $('sort-select').value = sort; await refresh();
  } catch (e) { toast(e.message); }
}
async function download(id, force = false) {
  const repo = state.repos.find(r => r.id === id);

  if (downloading.has(id)) return;
  startClientOperation(id, 'zip');
  if (selectedId === id) $('detail-download')?.setAttribute('disabled', '');
  toast('正在下载源码 ZIP，完整保存后会标记为已下载。');
  try {
    const result = await api(`/api/download?id=${encodeURIComponent(id)}`, { method: 'POST' });
    toast(`已保存到 ${result.path}`); await refresh();
    if (selectedId === id && $('project-dialog').open) await openProject(id);
  } catch (e) { await operationFailed(id, e); }
  finally { pendingOperations.delete(id); downloading.delete(id); render(); if (selectedId === id) $('detail-download')?.removeAttribute('disabled'); }
}
function link(url) { try { const parsed = new URL(url); return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname === 'api.github.com') ? escape(url) : '#'; } catch { return '#'; } }
function chart(data, width = 600) {
  const total = data.metric === 'cumulative-stars-created', label = total ? '每日累计获星' : '每日新增 Star';
  width = Math.max(200, Math.min(900, Math.round(width)));
  const left = 42, right = width - 14;
  const history = data.points;
  if (!history.length) return '<p class="detail-note">所选时段暂无可用 Star 历史记录。</p>';
  const peak = Math.max(...history.map(p => p.stars));
  const max = Math.max(1, peak);
  const first = Date.parse(history[0].date), last = Date.parse(history.at(-1).date);
  const points = history.map(p => [first === last ? (left + right) / 2 : left + (Date.parse(p.date) - first) * (right - left) / (last - first), 125 - p.stars / max * 105]);
  // Missing source days remain gaps instead of an invented interpolated line.
  const segments = []; let segment = [];
  history.forEach((p, i) => {
    if (i && Date.parse(p.date) - Date.parse(history[i - 1].date) > 86400000) { segments.push(segment); segment = []; }
    segment.push(points[i]);
  });
  segments.push(segment);
  return `<svg class="chart ${history.length > 180 ? 'dense-chart' : ''}" viewBox="0 0 ${width} 165" role="img" aria-label="${escape(`${label}，${history[0].date} 至 ${history.at(-1).date}，峰值 ${peak}`)}"><path d="M${left} 20H${right}M${left} 72.5H${right}M${left} 125H${right}" stroke="#e2e9d7" stroke-width="1"/><text x="${left-9}" y="24" text-anchor="end">${number(max)}</text><text x="${left-9}" y="76" text-anchor="end">${number(Math.round(max / 2))}</text><text x="${left-9}" y="129" text-anchor="end">0</text>${segments.filter(s => s.length > 1).map(s => `<polyline points="${s.map(p => p.join(',')).join(' ')}"/>`).join('')}${points.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${history.length > 180 ? 1.5 : 2.5}"><title>${escape(history[i].date)} · ${total ? '累计获星' : '新增'} ${history[i].stars.toLocaleString()} Stars</title></circle>`).join('')}<text x="${left}" y="150">${escape(history[0].date)}</text><text x="${right}" y="150" text-anchor="end">${escape(history.at(-1).date)}</text></svg><p class="detail-note"><a href="https://docs.github.com/en/rest/activity/starring#get-repository-star-history" target="_blank" rel="noopener noreferrer">${escape(data.source)} ↗</a> · 查询于 ${fullDate(data.fetchedAt)}<br>${escape(data.note)}</p>`;
}
async function loadHistory(id, days = trendDays, refresh = false) {
  trendDays = days; const request = ++trendRequest;
  const container = $('trend-content'); if (!container) return;
  container.innerHTML = '<p class="detail-note" role="status">正在查询 GitHub 历史数据…</p>';
  document.querySelectorAll('[data-trend-days]').forEach(b => { b.classList.toggle('selected', (b.dataset.trendDays === 'all' ? 'all' : Number(b.dataset.trendDays)) === days); b.setAttribute('aria-pressed', (b.dataset.trendDays === 'all' ? 'all' : Number(b.dataset.trendDays)) === days); });
  document.querySelectorAll('[data-trend-metric]').forEach(b=>{const active=b.dataset.trendMetric === trendMetric;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
  if($('trend-metric-label')) $('trend-metric-label').textContent = trendMetric === 'total' ? '每日累计获星' : '每日新增';
  try {
    const data = await api(`/api/history?id=${encodeURIComponent(id)}&days=${days}&metric=${trendMetric}${refresh ? '&refresh=1' : ''}`);
    if (request !== trendRequest || selectedId !== id || !$('project-dialog').open || !container.isConnected) return;
    container.innerHTML = chart(data, container.clientWidth);
  } catch (error) {
    if (request !== trendRequest || selectedId !== id || !container.isConnected) return;
    container.innerHTML = `<p class="detail-note">历史数据暂时无法加载：${escape(error.message)}</p><button class="text-button" id="retry-trend">重新查询</button>`;
    $('retry-trend').onclick = () => loadHistory(id, days, true);
  }
}
async function openProject(id) {
  selectedId = id; ++trendRequest; const dialog = $('project-dialog');
  $('detail-content').innerHTML = '<div class="loading-detail">正在读取真实项目数据…</div>';
  if (!dialog.open) dialog.showModal();
  try {
    const r = await api(`/api/project?id=${encodeURIComponent(id)}`);
    if (selectedId !== id || !dialog.open) return;
    const [, tone] = categoryMeta[r.category] || categoryMeta['其他'];
    $('detail-content').innerHTML = `<div class="detail-title"><span class="repo-icon tone-${tone}">${escape(r.name.slice(0, 1).toUpperCase())}</span><div><h2 id="detail-name">${escape(r.name)}</h2><small>${escape(r.id)} · ${escape(r.license || '许可证未标注')}</small></div></div><p class="detail-description">${escape(r.summary || r.description || '这个项目尚未完成简介分析。')}</p><div class="detail-tags">${[r.category, ...(r.tags || [])].filter(Boolean).map(t => `<button class="tag" data-tag="${escape(t)}">${escape(t)}</button>`).join('')}</div>${r.audience ? `<details class="project-analysis-evidence"><summary>dsh 项目分析 · 查看依据</summary><p><strong>目标用户：</strong>${escape(r.audience)}</p><p><strong>分类理由：</strong>${escape(r.categoryReason)}</p><h4>已确认能力</h4>${(r.capabilities || []).map(c => `<p>${escape(c.text)}</p><blockquote>${escape(c.quote)}<small>来源：${escape(c.source)}</small></blockquote>`).join('')}<h4>原文明示的限制</h4>${r.limitations?.length ? r.limitations.map(c => `<p>${escape(c.text)}</p><blockquote>${escape(c.quote)}</blockquote>`).join('') : '<p>提供内容中未发现明确限制，不将缺失信息当作缺陷。</p>'}</details>` : ''}${r.download ? `<div class="download-info ${r.update ? 'update-info' : ''}">${r.update ? '发现新版本' : '✓ 已下载'} · 本地 ${escape(r.download.zip?.versionLabel || r.download.git?.versionLabel || r.download.versionLabel || '未知')}${r.update ? ` → 最新 ${escape(r.versionLabel)}` : ''}<br><small>下载于 ${fullDate(r.download.zip?.downloadedAt || r.download.downloadedAt)} · ${escape(r.download.zip?.filename || r.download.git?.path || r.download.folder?.path || r.download.filename)}</small></div>` : ''}<div class="detail-stats"><div><strong>${number(r.stars)}</strong><span>Star 数量</span></div><div><strong>${number(r.forks)}</strong><span>Fork 数量</span></div><div><strong>${number(r.releaseDownloads)}</strong><span>Release 附件下载</span><small>${escape(r.downloadScope || 'GitHub 未提供源码下载次数')}</small></div></div><section class="detail-section"><div class="trend-heading"><h3>Star 趋势 <span id="trend-metric-label">每日新增</span></h3><button class="text-button" id="refresh-trend">${icon('refresh')}刷新历史</button></div><div class="quick-tabs trend-metrics" aria-label="Star 统计类型"><button data-trend-metric="growth">Star 增长趋势</button><button data-trend-metric="total">Star 数量趋势</button></div><div class="quick-tabs trend-ranges" aria-label="Star 历史查询范围">${[30,90,180,365,'all'].map(days => `<button data-trend-days="${days}">${days === 'all' ? '完整生命周期' : '近 '+(days === 365 ? '1 年' : `${days} 天`)}</button>`).join('')}</div><div id="trend-content" aria-live="polite"></div></section><section class="detail-section"><h3>${r.release ? '最新 Release' : '最新提交版本'} <span>${escape(r.versionLabel)}</span></h3>${r.release ? `<p class="detail-note">发布于 ${fullDate(r.release.publishedAt)} · <a href="${link(r.release.url)}" target="_blank" rel="noopener noreferrer">查看原始 Release ↗</a></p><pre class="release-note">${escape(r.release.body)}</pre>` : '<p class="detail-note">维护者尚未发布正式 Release，下载默认分支最新提交的源码。</p>'}${r.assets?.length ? `<h3>可用 Release 附件</h3><div class="asset-list">${r.assets.map(a => `<a href="${link(a.url)}" target="_blank" rel="noopener noreferrer">${escape(a.name)} ↗</a>`).join('')}</div><p class="detail-note">Release 附件打开 GitHub 原始下载链接；本地「已下载」跟踪的是下方按钮保存的源码版本。</p>` : ''}</section><section class="detail-section"><h3>最近提交 <span>默认分支</span></h3><ul class="commit-list">${(r.commits || []).map(c => `<li><code>${escape(c.sha.slice(0, 7))}</code><a href="${link(c.url)}" target="_blank" rel="noopener noreferrer">${escape(c.message.split('\n')[0])}</a><time>${date(c.date)}</time></li>`).join('') || '<li>暂无提交数据</li>'}</ul></section><p class="detail-note">简介来源：${escape(r.analysisSource || '尚未分析')} · 内容依据：${escape(r.contentSource || '仓库元数据')}<br>版本检查：${fullDate(r.checkedAt)} · Star / Fork 数据采集：${fullDate(r.analyzedAt || state.analyzedAt)}</p><div class="detail-actions"><a class="text-button" href="${link(r.url)}" target="_blank" rel="noopener noreferrer">${icon('github')}在 GitHub 查看${icon('arrow')}</a><div>${r.download?.zip ? `<a class="button secondary" href="/api/file?id=${encodeURIComponent(id)}">取回已下载文件</a> ` : ''}${projectActions(r)}${r.download && !r.download.git && !r.localOnly ? `<button class="button secondary" data-repo-action="clone" data-id="${escape(r.id)}">克隆项目（开发者）</button>` : ''}</div></div>`;
    if (r.detailError) { const warning=document.createElement('p');warning.className='operation-error';warning.textContent=`远端版本信息未更新：${r.detailError}；下方仍展示本地缓存。`;$('detail-content').prepend(warning); }
    if (r.localOnly) { document.querySelectorAll('#detail-content .detail-stats, #detail-content .detail-section, #detail-content .detail-actions > a').forEach(el => el.remove()); }
    if (r.download?.git) { const git = r.download.git; const box = document.createElement('p'); box.className = 'detail-note git-status'; box.textContent = `Git 路径：${git.path} · 分支：${git.branch || '游离 HEAD'} · 本地 ${git.head?.slice(0,7) || '无提交'}${git.checkedAt ? ` · 落后 ${git.behind ?? '?'} / 领先 ${git.ahead ?? '?'} 个提交` : ' · 尚未检查分支更新'}`; $('detail-content').append(box); }
    document.querySelectorAll('[data-trend-days]').forEach(b => b.onclick = () => loadHistory(id, b.dataset.trendDays === 'all' ? 'all' : Number(b.dataset.trendDays)));
    document.querySelectorAll('[data-trend-metric]').forEach(b=>b.onclick=()=>{trendMetric=b.dataset.trendMetric;loadHistory(id);});
    $('refresh-trend').onclick = () => loadHistory(id, trendDays, true);
    if (!r.localOnly) loadHistory(id);
    await refresh();
  } catch (e) {
    if (selectedId === id) {
      $('detail-content').innerHTML = `<div class="error-detail"><h2 id="detail-name">暂时无法读取详情</h2><p>${escape(e.message)}</p><button class="button secondary" id="retry-detail">重新读取</button></div>`;
      $('retry-detail').onclick = () => openProject(id);
    }
  }
}
async function checkUpdates() {
  const button = $('check-updates'); button.disabled = true;
  try { const result = await api('/api/updates', { method: 'POST' }); await refresh(); toast(result.errors.length ? `部分检查失败：${result.errors.slice(0,3).join('；')}` : result.analyzedCount ? `已分析 ${result.analyzedCount} 个目录项目，可在「已下载」查看。` : result.count ? `发现 ${result.count} 个项目有新版本` : '检查完成，已下载项目暂无新版本。'); }
  catch (e) { toast(e.message); } finally { button.disabled = false; }
}
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => applyView(b.dataset.view));
$('categories').onclick = e => { const b = e.target.closest('[data-category]'); if (b) { category = category === b.dataset.category ? '' : b.dataset.category; tag = ''; render(); } };
$('quick-tabs').onclick = e => { const b = e.target.closest('[data-filter]'); if (b) { category = { all: '', ai: '人工智能', research: '科研学术', design: '艺术设计' }[b.dataset.filter]; tag = ''; render(); } };
document.body.addEventListener('click', async e => {
  if (e.target.closest('[data-cancel-generation]')) { try { await api('/api/cancel', {method:'POST'}); await refresh(); } catch(error) { toast(error.message); } return; }
  if (e.target.closest('[data-inspire]')) { inspire(); return; }
  if (e.target.closest('[data-implement]')) { implement(); return; }
  const tagButton = e.target.closest('[data-tag]');
  if (tagButton) { tag = tagButton.dataset.tag; category = ''; $('project-dialog').close(); selectedId = ''; render(); return; }
  const actionButton = e.target.closest('[data-repo-action]'); if (actionButton) { projectAction(actionButton.dataset.id, actionButton.dataset.repoAction); return; }
  const downloadButton = e.target.closest('[data-download]'); if (downloadButton) { download(downloadButton.dataset.download); return; }
  const card = e.target.closest('[data-project]'); if (card) openProject(card.dataset.project);
});
$('project-grid').addEventListener('keydown', e => { if (e.target.matches('[data-project]') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); openProject(e.target.dataset.project); } });
$('search-input').oninput = e => { search = e.target.value.trim(); render(); };
$('sort-select').onchange = e => { sort = e.target.value; if (['stars', 'growth'].includes(sort)) rankingMode = sort; render(); };
$('display-modes').onclick = e => { const b = e.target.closest('[data-display-mode]'); if (b) { rankingMode = b.dataset.displayMode; sort = rankingMode; $('sort-select').value = sort; render(); } };
$('display-period').onchange = e => { rankingPeriod = e.target.value; render(); };
$('chart-periods').onclick = e => { const b = e.target.closest('[data-chart-period]'); if (b) { rankingPeriod = b.dataset.chartPeriod; render(); } };
$('inspire-button').onclick = inspire; $('inspire-swap').onclick = inspire;
$('github-token-form').onsubmit = async e => { e.preventDefault(); const input=$('github-token-input'), button=e.submitter; if(button)button.disabled=true; try { await api('/api/github-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:input.value})});input.value='';$('github-token-message').textContent='Token 已保存到 config/github.token，后续请求优先使用。';await refresh(); } catch(error){$('github-token-message').textContent=error.message;}finally{if(button)button.disabled=false;} };
$('remove-github-token').onclick = async () => { try { await api('/api/github-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove:true})});$('github-token-message').textContent='本地 Token 已删除。';await refresh(); }catch(error){$('github-token-message').textContent=error.message;} };
$('comparison-legend').onclick = e => { const b = e.target.closest('[data-series-id]'); if (!b) return; const id = b.dataset.seriesId; focusedSeries.has(id) ? focusedSeries.delete(id) : focusedSeries.add(id); overviewKey = ''; renderOverview(); };
$('clear-chart-focus').onclick = () => { focusedSeries.clear(); overviewKey = ''; renderOverview(); };
$('refresh-ranking').onclick = () => updateRanking(true);
$('cancel-ranking').onclick = async () => { try { await api('/api/ranking/cancel', {method:'POST'}); await refresh(); } catch(e) { toast(e.message); } };
$('clear-filter').onclick = () => { tag = ''; render(); };
$('analyze-button').onclick = analyze;
$('cancel-button').onclick = async () => { try { await api('/api/cancel', { method: 'POST' }); await refresh(); } catch (e) { toast(e.message); } };
$('empty-action').onclick = () => { if (!revealed) analyze(); else if (view === 'updates') checkUpdates(); else if (!state.repos.length) analyze(); else { applyView('explore'); render(); } };
$('check-updates').onclick = checkUpdates;
$('close-dialog').onclick = () => { $('project-dialog').close(); selectedId = ''; };
$('project-dialog').addEventListener('close', () => selectedId = '');
$('help-button').onclick = () => $('help-dialog').showModal(); $('close-help').onclick = () => $('help-dialog').close();
for (const dialog of [$('help-dialog'), $('project-dialog')]) dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
refresh(); setInterval(refresh, 2000);
setInterval(() => { if (downloading.size || state.repos.some(r => r.operation?.status === 'running')) refresh(); }, 500);
function syncThemeButton() {
  const dark = window.WhatsNewTheme.get() === 'dark', button = $('theme-toggle');
  const label = dark ? '切换到浅色模式' : '切换到深色模式';
  button.innerHTML = icon(dark ? 'sun' : 'moon'); button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(dark));
}
$('theme-toggle').onclick = () => window.WhatsNewTheme.toggle();
window.addEventListener('whatsnew-themechange', () => { syncThemeButton(); overviewKey = ''; renderOverview(); });
syncThemeButton();

function renderNetwork() {
  const network = state.network; if (!network) return;
  const key = JSON.stringify(network); if (networkKey === key) return; networkKey = key;
  $('network-address').innerHTML = network.urls.length ? network.urls.map(url => `<a href="${escape(url)}" target="_blank" rel="noopener">${escape(url)}</a><button class="text-button" data-copy-url="${escape(url)}">复制</button>`).join('<br>') : '未检测到局域网 IPv4，请连接 Wi-Fi 或网线，页面会自动刷新地址。';
  document.querySelectorAll('[data-copy-url]').forEach(button => button.onclick = async () => {
    try { await navigator.clipboard.writeText(button.dataset.copyUrl); toast('访问地址已复制。'); } catch { toast(`访问地址：${button.dataset.copyUrl}`); }
  });
}
async function projectAction(id, action) {
  if (action === 'zip') return download(id, true);
  if (downloading.has(id)) return;
  startClientOperation(id, action);
  try {
    toast(action === 'clone' ? '正在克隆到默认目录…' : action === 'pull' ? '正在快进拉取项目…' : '扫描目录并检查此项目…');
    const endpoint = action === 'check' ? 'updates' : action;
    const result = await api(`/api/${endpoint}?id=${encodeURIComponent(id)}`, { method: 'POST' });
    if (result.errors?.length) throw new Error(result.errors.slice(0,3).join('；'));
    toast(action === 'check' ? '项目检查完成，打开详情查看版本说明。' : `已完成，项目路径：${result.path}`);
    await refresh(); if (selectedId === id && $('project-dialog').open) await openProject(id);
  } catch (error) { await operationFailed(id, error); }
  finally { pendingOperations.delete(id); downloading.delete(id); render(); }
}
async function updateRanking(force = false) {
  if (!revealed) { render(); return; }
  try {
    // Only the explicit recollect action performs network work.
    await api(`/api/ranking?refresh=${force ? 1 : 0}`, { method: 'POST' });
    await refresh();
  } catch (error) { toast(error.message); }
}
function histogramChart(bins) {
  const max = Math.max(1, ...bins.map(b => b.count));
  return `<svg class="histogram-chart" viewBox="0 0 360 195" role="img" aria-label="累计 Star 数量直方图，纵轴为项目数量"><path d="M28 12V151H348" fill="none" stroke="#dfe6d8"/>${bins.map((b,i) => { const height = b.count / max * 125; return `<rect x="${36+i*39}" y="${150-height}" width="27" height="${height}" rx="4" fill="#8baf56"><title>${number(b.from)}–${number(b.to)} Stars：${b.count} 个项目</title></rect><text x="${49.5+i*39}" y="${142-height}" text-anchor="middle">${b.count}</text>`; }).join('')}<text x="28" y="175">0 Stars</text><text x="348" y="175" text-anchor="end">${number(bins.at(-1).to)} Stars</text></svg><details class="chart-table"><summary>查看分布数值</summary><table><thead><tr><th>累计 Star 区间</th><th>项目数</th></tr></thead><tbody>${bins.map((b,i) => `<tr><td>${b.from.toLocaleString('zh-CN')} ≤ Star ${i===7?'≤':'<'} ${b.to.toLocaleString('zh-CN')}</td><td>${b.count}</td></tr>`).join('')}</tbody></table></details>`;
}
function pieChart(categories) {
  const colors = ['#8daf56','#b9ca8b','#839bb6','#bd9ecb','#d6b273','#8dbcb0','#a9b1b9','#cbb7a7','#d7ddcf'];
  const rows = Object.entries(categories).sort((a,b)=>b[1]-a[1]); const total = rows.reduce((n,[,c])=>n+c,0); let offset = 0;
  return `<div class="pie-layout"><svg viewBox="0 0 160 160" role="img" aria-label="${escape(rows.map(([name,n])=>`${name} ${n} 个`).join('，'))}">${rows.map(([name,n],i) => { const amount=n/total*100; const circle=`<circle cx="80" cy="80" r="58" fill="none" stroke="${colors[i%colors.length]}" stroke-width="24" pathLength="100" stroke-dasharray="${amount} ${100-amount}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${escape(name)}：${n} 个（${(n/total*100).toFixed(1)}%）</title></circle>`;offset+=amount;return circle;}).join('')}<text x="80" y="79" text-anchor="middle" class="pie-total">${total}</text><text x="80" y="99" text-anchor="middle">个项目</text></svg><ul class="pie-legend">${rows.map(([name,n],i)=>`<li><svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${colors[i%colors.length]}"/></svg><span>${escape(name)}</span><b>${(n/total*100).toFixed(0)}%</b><small>${n} 个</small></li>`).join('')}</ul></div>`;
}
function renderOverview() {
  const overview = state.overviews?.[rankingPeriod] || state.overview; $('overview-panel').hidden = !revealed || !overview?.total;
  if (!revealed || !overview?.total) return;
  if (zoomPeriod !== rankingPeriod) { zoomState = null; zoomPeriod = rankingPeriod; }
  const key = JSON.stringify([overview, state.rankingJob, state.demo, rankingMode, [...focusedSeries], zoomState, window.WhatsNewTheme.get()]); if (overviewKey === key) return; overviewKey = key;
  $('overview-scope').textContent = `${overview.scope} · ${rankingMode === 'growth' ? '按新增 Star 排序' : '按累计 Star 排序'} · ${overview.from} 至 ${overview.to}`;
  $('ranking-status').textContent = state.rankingJob?.message || '准备采集官方历史…';
  $('refresh-ranking').disabled = state.rankingJob?.status === 'running';
  $('cancel-ranking').hidden = state.rankingJob?.status !== 'running';
  document.querySelectorAll('[data-chart-period]').forEach(b => { b.classList.toggle('selected', b.dataset.chartPeriod === rankingPeriod); b.setAttribute('aria-pressed', b.dataset.chartPeriod === rankingPeriod); });
  const series = [...(overview.projectTrends || [])].sort((a,b) => rankingMode === 'growth' ? (b.growth ?? -1) - (a.growth ?? -1) || (b.stars || 0) - (a.stars || 0) : (b.stars || 0) - (a.stars || 0));
  $('overview-trend').innerHTML = comparisonChart(series, $('overview-trend').clientWidth);
  $('comparison-legend').innerHTML = series.map((r,i) => `<button data-series-id="${escape(r.id)}" class="series-item ${focusedSeries.has(r.id) ? 'focused' : ''}" aria-pressed="${focusedSeries.has(r.id)}"><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${seriesColor(r.id)}"/></svg><span>${rankingMode === 'growth' && r.growth == null ? '—' : i+1}. ${escape(r.id)}</span><small>${r.growth == null ? '历史不全' : '+'+number(r.growth)}</small></button>`).join('');
  $('overview-histogram').innerHTML = histogramChart(overview.histogram);
  $('overview-pie').innerHTML = pieChart(overview.categories);
  $('overview-note').textContent = `${state.demo ? '演示统计，非真实榜单。' : overview.source + '。'}增星历史完整覆盖 ${overview.covered}/${overview.total} 项目${overview.complete ? '' : '；当前增星排名仅代表可用数据，缺失项目置于末尾；曲线在缺失日断开'}。每个榜单项目一条每日新增 Star 曲线，共 ${overview.total} 条；完整过去 7／30 天，排除今天，不代表净增长或历史累计量。直方图和类型占比覆盖全部 ${overview.total} 个榜单项目，不含目录中的额外项目。`;
}

window.addEventListener('resize', () => { overviewKey = ''; renderOverview(); });

function usageLabel(usage, label = '本次') {
  if (!usage) return '';
  if (!usage.finishedAt) return 'dsh 用量统计中…';
  if (!usage.sessions) return `${label} 0 Token · 估算 $0（复用缓存，无模型调用）`;
  if (!usage.reportedTurns) return `${label} Token 用量未返回 · 费用无法估算`;
  const tokens = `${usage.complete ? '' : '≥ '}${usage.totalTokens.toLocaleString('zh-CN')}`;
  const amount = n => n === 0 ? '0' : n.toFixed(n < .01 ? 6 : 4);
  const cost = !usage.pricingComplete ? '费用无法完整估算' : usage.costMinUsd === usage.costMaxUsd ? `估算 $${amount(usage.costMinUsd)}` : `估算 $${amount(usage.costMinUsd)}–${amount(usage.costMaxUsd)}`;
  return `${label} ${tokens} Token · ${cost}${usage.complete ? '' : '（部分调用用量缺失）'}`;
}
function seriesColor(id) {
  let value = 0; for (const c of id) value = (Math.imul(value,31) + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(value) % 360} 46% ${window.WhatsNewTheme.get() === 'dark' ? 66 : 47}%)`;
}
function comparisonChart(series, width = 600) {
  const available = series.filter(r => r.points.some(p => p.stars != null));
  comparisonContext = null;
  if (!available.length) { for (const id of ['chart-zoom-in','chart-zoom-out','chart-zoom-reset']) $(id).disabled = true; $('chart-zoom-label').textContent = '1×'; return '<div class="chart-placeholder">正在查询各项目的官方 Star 历史…<br>暂无可用曲线，缺失数据不会按零绘制。</div>'; }
  width = Math.max(230, Math.min(1000, Math.round(width)));
  const length = series[0].points.length, window = zoomState || { start: 0, end: length-1 }, span = window.end-window.start;
  const left=48, right=width-18, baseline=168, scaling=focusedSeries.size?available.filter(r=>focusedSeries.has(r.id)):available;
  const max=Math.max(1,...(scaling.length?scaling:available).flatMap(r=>r.points.slice(Math.floor(window.start),Math.ceil(window.end)+1).filter(p=>p.stars!=null).map(p=>p.stars)));
  const x=i=>left+(i-window.start)*(right-left)/span, y=v=>baseline-v/max*140;
  const start=Math.ceil(window.start), end=Math.floor(window.end), ticks = width>650 && end-start>7 ? [start,Math.round((start*3+end)/4),Math.round((start+end)/2),Math.round((start+end*3)/4),end] : [start,Math.round((start+end)/2),end];
  comparisonContext = { series, available, length, width, left, right, window, x, y };
  $('chart-zoom-label').textContent = `${((length-1)/span).toFixed(1)}× · ${series[0].points[start].date.slice(5)}–${series[0].points[end].date.slice(5)}`;
  $('chart-zoom-in').disabled = !chartWindow || span <= 1;
  $('chart-zoom-out').disabled = $('chart-zoom-reset').disabled = !chartWindow || span >= length-1;
  const paths=series.map(r=>{
    const chunks=[];let chunk=[];
    r.points.forEach((p,i)=>{if(p.stars==null){if(chunk.length)chunks.push(chunk);chunk=[];}else chunk.push([x(i),y(p.stars),p]);});if(chunk.length)chunks.push(chunk);
    const focus=focusedSeries.has(r.id), opacity=focusedSeries.size?(focus?1:.055):.36;
    return `<g data-chart-line="${escape(r.id)}" class="comparison-line" stroke="${seriesColor(r.id)}" opacity="${opacity}" stroke-width="${focus?2.8:1.4}" fill="none"><title>${escape(r.id)} · 时段新增 ${r.growth==null?'未知':r.growth.toLocaleString('zh-CN')} Star</title>${chunks.map(c=>c.length===1?`<circle cx="${c[0][0]}" cy="${c[0][1]}" r="${focus?4:2.6}" fill="${seriesColor(r.id)}"/>`:`<polyline points="${c.map(p=>p.slice(0,2).join(',')).join(' ')}"/>`).join('')}</g>`;
  }).join('');
  // Focused lines are drawn last while all 100 project groups remain present.
  const content=`<svg id="comparison-svg" class="comparison-chart" tabindex="0" viewBox="0 0 ${width} 208" role="img" aria-label="${series.length} 个项目的每日新增 Star，${available.length} 个项目有可用数据"><defs><clipPath id="comparison-plot"><rect x="${left-5}" y="18" width="${right-left+10}" height="155"/></clipPath></defs><path d="M${left} 28H${right}M${left} 98H${right}M${left} 168H${right}" stroke="#e2e8d9" fill="none"/><text x="${left-8}" y="31" text-anchor="end">${number(max)}</text><text x="${left-8}" y="101" text-anchor="end">${number(Math.round(max/2))}</text><text x="${left-8}" y="171" text-anchor="end">0</text><g clip-path="url(#comparison-plot)">${paths}${series.filter(r=>focusedSeries.has(r.id)).map(r=>{ const chunks=[];let path='';r.points.forEach((p,i)=>{if(p.stars==null){if(path)chunks.push(path);path='';}else path+=(path?'L':'M')+x(i)+','+y(p.stars);});if(path)chunks.push(path);return chunks.map(d=>`<path d="${d}" stroke="${seriesColor(r.id)}" stroke-width="2.8" fill="none" pointer-events="none"/>`).join('');}).join('')}</g>${[...new Set(ticks)].map(i=>`<text x="${x(i)}" y="194" text-anchor="${i===start?'start':i===end?'end':'middle'}">${escape(series[0].points[i].date.slice(5))}</text>`).join('')}</svg><p id="comparison-tooltip" class="comparison-tooltip" hidden></p>`;
  return content;
}
function changeZoom(factor, anchor = .5) {
  if (!chartWindow || !comparisonContext) return;
  zoomState = chartWindow.zoomWindow(comparisonContext.window, comparisonContext.length, factor, anchor);
  overviewKey = ''; renderOverview();
}
function panChart(delta) {
  if (!chartWindow || !comparisonContext) return;
  zoomState = chartWindow.panWindow(comparisonContext.window, comparisonContext.length, delta);
  overviewKey = ''; renderOverview();
}
$('chart-zoom-in').onclick = () => changeZoom(2);
$('chart-zoom-out').onclick = () => changeZoom(.5);
$('chart-zoom-reset').onclick = () => { zoomState = null; overviewKey = ''; renderOverview(); };
const chartSurface = $('overview-trend'), chartPointers = new Map();
function chartPosition(clientX, clientY) {
  const svg = $('comparison-svg'), c = comparisonContext; if (!svg || !c) return null;
  const rect = svg.getBoundingClientRect();
  return { px: (clientX-rect.left)*c.width/rect.width, py: (clientY-rect.top)*208/rect.height, plotWidth: (c.right-c.left)*rect.width/c.width };
}
function inspectChart(e) {
  const c = comparisonContext, position = chartPosition(e.clientX,e.clientY), output = $('comparison-tooltip'); if (!c || !position || !output) return;
  const index = Math.min(c.length-1,Math.max(0,Math.round(c.window.start+(position.px-c.left)/(c.right-c.left)*(c.window.end-c.window.start))));
  const candidates = c.available.filter(r => (!focusedSeries.size || focusedSeries.has(r.id)) && r.points[index].stars != null);
  candidates.sort((a,b) => Math.abs(c.y(a.points[index].stars)-position.py)-Math.abs(c.y(b.points[index].stars)-position.py));
  const repo = candidates[0]; output.hidden = !repo || Math.abs(c.y(repo.points[index].stars)-position.py)>25;
  if (!output.hidden) output.textContent = `${repo.id} · ${repo.points[index].date} · 新增 ${repo.points[index].stars.toLocaleString('zh-CN')} Star`;
}
chartSurface.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || !e.target.closest('#comparison-svg')) return;
  e.preventDefault(); const c = comparisonContext, p = chartPosition(e.clientX,e.clientY);
  if (c && p) changeZoom(Math.exp(-Math.max(-200,Math.min(200,e.deltaY))*.006), (p.px-c.left)/(c.right-c.left));
}, { passive: false });
chartSurface.addEventListener('pointerdown', e => {
  if (!e.target.closest('#comparison-svg') || e.button !== 0) return;
  chartPointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); chartSurface.setPointerCapture(e.pointerId); inspectChart(e);
});
chartSurface.addEventListener('pointermove', e => {
  const previous = chartPointers.get(e.pointerId), c = comparisonContext;
  if (!previous || !c) { inspectChart(e); return; }
  const position = chartPosition(e.clientX,e.clientY);
  if (chartPointers.size === 2) {
    const other = [...chartPointers].find(([id]) => id !== e.pointerId)[1];
    const oldDistance = Math.hypot(previous.x-other.x,previous.y-other.y), distance = Math.hypot(e.clientX-other.x,e.clientY-other.y);
    const middle = chartPosition((e.clientX+other.x)/2,(e.clientY+other.y)/2);
    if (oldDistance > 5 && distance > 5) changeZoom(distance/oldDistance, (middle.px-c.left)/(c.right-c.left));
  } else if (position && c.window.end-c.window.start < c.length-1) {
    panChart(-(e.clientX-previous.x)/position.plotWidth*(c.window.end-c.window.start));
  } else inspectChart(e);
  chartPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
});
for (const event of ['pointerup','pointercancel','lostpointercapture']) chartSurface.addEventListener(event,e => chartPointers.delete(e.pointerId));
chartSurface.addEventListener('pointerleave', () => { if ($('comparison-tooltip') && !chartPointers.size) $('comparison-tooltip').hidden = true; });
chartSurface.addEventListener('keydown', e => {
  if (e.target.id !== 'comparison-svg' || !comparisonContext) return;
  if (['+','=','-','ArrowLeft','ArrowRight','Home'].includes(e.key)) e.preventDefault(); else return;
  if (e.key === 'Home') $('chart-zoom-reset').click();
  else if (['+','='].includes(e.key)) changeZoom(2);
  else if (e.key === '-') changeZoom(.5);
  else panChart((e.key === 'ArrowRight' ? 1 : -1)*(comparisonContext.window.end-comparisonContext.window.start)*.2);
  $('comparison-svg')?.focus({preventScroll:true});
});
