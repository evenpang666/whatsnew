import { mkdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { GitHubClient, hasUpdate } from './github.js';
import { ANALYSIS_VERSION } from './contracts.js';
import { PROJECT_FILES } from './project-builder.js';
import { LocalProjects } from './local-projects.js';
import { emptyUsage, addUsage } from './usage.js';
import { calculateOverview, PERIODS } from './ranking.js';
import { isRepeatedIdea } from './idea-history.js';
import { quantityHistory, withCumulativeHistory, hasCumulativeHistory } from './star-history.js';
import { DeepSeekToken } from './deepseek-token.js';

export class WhatsNewService {
  constructor({ root = process.cwd(), github, analyze, inspire, buildProject, demo = false, localProjects } = {}) {
    this.root = resolve(root); this.github = github || new GitHubClient({root:this.root}); this.analyze = analyze; this.inspire = inspire; this.buildProject = buildProject; this.demo = demo;
    this.deepseekCredentials = new DeepSeekToken(this.root);
    this.statePath = join(this.root, '.runtime', demo ? 'demo-state.json' : 'state.json');
    this.state = { repos: [], localRepos: [], downloads: {}, details: {}, starHistories: {}, inspiration: null, implementation: null, analyzedAt: null, operations: {}, usage: { analysis: null, inspiration: null } };
    this.local = localProjects || new LocalProjects(this.root); this.scanAt = 0; this.scanWarnings = [];
    this.visible = false; this.analysisFinished = false; this.mode = 'stars'; this.period = 'week';
    this.rankingJob = { status: 'idle', progress: 0, total: 100, errors: [], message: '' };
    this.gitTasks = new Map(); this.localJob = { status: 'idle', message: '' };
    this.job = { status: 'idle', progress: 0, total: 100, message: '准备好探索开源世界', errors: [] };
    this.saveQueue = Promise.resolve(); this.activeDownloads = new Set();
    this.downloadTasks = new Map(); this.shutdownController = new AbortController(); this.closed = false;
    this.historyTasks = new Map();
    this.inspirationJob = { status: 'idle', message: '完成项目分析并展示后，可手动生成新项目灵感' };
    this.implementationJob = { status: 'idle', progress: 0, total: 6, message: '' };
  }
  async init() {
    await mkdir(join(this.root, '.runtime'), { recursive: true });
    try { this.state = { ...this.state, ...JSON.parse(await readFile(this.statePath, 'utf8')) }; }
    catch (e) { if (e.code !== 'ENOENT') this.job.message = '本地缓存无法读取，将重新获取榜单。'; }
    let migratedHistory = false;
    for (const [key, history] of Object.entries(this.state.starHistories)) {
      if (!key.endsWith(':all')) continue;
      try {
        const prepared = withCumulativeHistory(history);
        if (prepared !== history) { this.state.starHistories[key] = prepared; migratedHistory = true; }
      } catch { /* Incomplete cached history stays unknown and will be refetched. */ }
    }
    if (migratedHistory) await this.save();
    for (const operation of Object.values(this.state.operations)) if (operation.status === 'running') Object.assign(operation, { status: 'error', error: '上次操作被中断，请重试。', finishedAt: new Date().toISOString() });
    // Retire local analysis-run snapshots. They are never a historical source.
    delete this.state.history;
    // Resolve an interrupted run as retryable, keeping validated partial results.
    if (this.state.repos.some(r => this.needsAnalysis(r))) this.job = { ...this.job, status: 'partial', progress: this.state.repos.filter(r => !this.needsAnalysis(r)).length, message: '分析契约已升级或上次未完成，可继续逐项目分析' };
    if (this.state.inspiration) this.inspirationJob = { status: 'complete', message: '灵感已生成' };
    if (this.state.implementation) this.implementationJob = { status: 'complete', progress: 6, total: 6, message: '项目源码已保存' };
    this.visible = this.state.repos.some(r => r.analyzed);
    this.analysisFinished = Boolean(this.state.analyzedAt) && this.state.repos.length > 0 && this.state.repos.every(r => !this.needsAnalysis(r));
    if (this.analysisFinished) this.job = { status:'complete', progress:this.state.repos.length, total:this.state.repos.length, errors:[], message:'已恢复本地缓存，可重新分析更新榜单' };
    if (!this.demo) await this.scanDownloads(true);
    this.syncDownloadedMetadata();
    if (this.visible) {
      const overview = this.snapshot().overview;
      this.rankingJob = { ...this.rankingJob, status:overview.complete?'complete':'partial', message:`本地历史缓存 · 完整覆盖 ${overview.covered}/${overview.total} 项目` };
    }
  }
  save() {
    const snapshot = JSON.stringify(this.state);
    this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
      const tmp = `${this.statePath}.tmp`; await writeFile(tmp, snapshot, { mode: 0o600 }); await rename(tmp, this.statePath);
    });
    return this.saveQueue;
  }
  saveHistories() {
    // Concurrent fetches share one durable write instead of serializing the
    // growing lifecycle cache once for each response in the same burst.
    this.historySaveTask ||= new Promise((resolve, reject) => {
      setTimeout(() => { this.historySaveTask = null; this.save().then(resolve, reject); }, 20);
    });
    return this.historySaveTask;
  }
  overviewsAt(now = new Date()) {
    const key = JSON.stringify([now.toISOString().slice(0,10), this.state.repos.map(r => [r.id,r.name,r.stars,r.analyzed,r.category,r.createdAt])]);
    const sources = Object.entries(this.state.starHistories).map(([id,h]) => [id,h,h.to,h.fetchedAt,h.points,h.points?.length,h.cumulative]);
    const cached = this.overviewCache;
    if (cached?.key === key && sources.length === cached.sources.length && sources.every((entry,i) => entry.every((value,j) => value === cached.sources[i][j]))) return cached;
    const growth = Object.fromEntries(Object.keys(PERIODS).map(period => [period, calculateOverview(this.state.repos, this.state.starHistories, {mode:'growth',period,now})]));
    const ranks = Object.fromEntries([...this.state.repos].sort((a,b) => (b.stars ?? -1) - (a.stars ?? -1)).map((r,i) => [r.id,i+1]));
    const stars = Object.fromEntries(Object.entries(growth).map(([period,overview]) => [period,{...overview,mode:'stars',ranks}]));
    return this.overviewCache = {key,sources,growth,stars};
  }
  snapshot() {
    const repos = [...this.state.repos];
    for (const [id, record] of Object.entries(this.state.downloads)) {
      if (!repos.some(r => r.id === id) && record.repo) repos.push({ ...(this.state.localRepos.find(r => r.id === id) || record.repo), archived: true });
    }
    const asOf = this.job.status === 'running' || this.rankingJob.status === 'running' ? new Date() : new Date(this.state.rankingAsOf || this.state.analyzedAt || Date.now());
    const now = Number.isFinite(asOf.getTime()) ? asOf : new Date();
    const cachedOverviews = this.overviewsAt(now), overview = cachedOverviews[this.mode][this.period], overviews = cachedOverviews.growth;
    return { demo: this.demo, visible: this.visible, job: this.job, analyzedAt: this.state.analyzedAt, cachedCatalog: this.visible && this.job.status !== 'running',
      repos: repos.filter(r => this.visible || this.state.downloads[r.id]).map(r => ({ ...r, readme: undefined, download: this.state.downloads[r.id] || null, operation: this.state.operations[r.id] || null, update: this.isUpdated(r.id), growth: overview.values[r.id] ?? null, growthRank: overview.ranks[r.id] ?? null })),
      downloadedCount: Object.keys(this.state.downloads).length,
      updatesCount: Object.keys(this.state.downloads).filter(id => this.isUpdated(id)).length,
      overview: this.visible ? overview : null, overviews: this.visible ? overviews : null, usage: this.visible ? this.state.usage : null, rankingJob: this.rankingJob, localJob: this.localJob, scanWarnings: this.scanWarnings,
      inspiration: this.visible ? this.state.inspiration : null, inspirationJob: this.inspirationJob, inspirationReady: this.visible && this.analysisFinished && this.canInspire(), implementation: this.visible ? this.state.implementation : null, implementationJob: this.implementationJob,
      downloadPath: join(this.root, 'downloads'), engine: this.demo ? '演示模式' : 'DeepSeek Harness' };
  }
  startAnalysis(resume = false) {
    if (this.closed) throw new Error('服务正在关闭。');
    if (this.job.status === 'running') throw new Error('分析正在进行，请等待完成。');
    if (this.localJob.status === 'running') throw new Error('请等待本地项目检查与分析完成。');
    if (this.rankingJob.status === 'running') throw new Error('请等待 Star 历史采集完成，或先暂停。');
    if (this.inspirationJob.status === 'running' || this.implementationJob.status === 'running') throw new Error('请等待灵感或项目撰写完成。');
    this.visible = true; this.analysisFinished = false;
    this.state.usage ||= {}; this.state.usage.analysis = { ...emptyUsage(), startedAt: new Date().toISOString() };
    this.controller = new AbortController();
    this.job = { status: 'running', progress: 0, total: 100, message: '连接 GitHub，获取 Star 前 100…', errors: [] };
    this.analysisTask = this.runAnalysis(resume, this.controller.signal).catch(error => {
      this.job.status = this.controller.signal.aborted ? 'cancelled' : 'error';
      this.job.message = this.controller.signal.aborted ? '分析已暂停，已完成的项目已保存' : error.message;
      this.job.errors.push(error.message);
    }).finally(async () => { this.analysisFinished = true; this.state.usage.analysis.finishedAt = new Date().toISOString(); try { await this.save(); } catch (e) { this.job.errors.push(`本次用量保存失败：${e.message}`); } });
    return this.job;
  }
  async runAnalysis(resume, signal) {
    if (!resume || !this.state.repos.length) {
      const repos = await this.github.top(signal); signal.throwIfAborted();
      const previous = new Map([...this.state.repos, ...this.state.localRepos].map(r => [r.id.toLowerCase(), r]));
      this.state.repos = repos.map(r => {
        const old = previous.get(r.id.toLowerCase());
        return old && !this.needsAnalysis(old) && old.branch === r.branch && old.pushedAt === r.pushedAt && old.description === r.description && JSON.stringify(old.topics) === JSON.stringify(r.topics) ? { ...old, ...r, analyzed: true, analysisVersion: ANALYSIS_VERSION } : r;
      });
      if (!this.demo && this.state.inspiration?.catalogHash !== this.catalogHash()) {
        this.state.inspiration = null; this.state.implementation = null;
        this.inspirationJob = { status: 'idle', message: '项目分析完成后，点击「灵感乍现」手动生成' };
        this.implementationJob = { status: 'idle', progress: 0, total: 6, message: '' };
      }
      await this.save();
    }
    const pending = this.state.repos.filter(r => this.needsAnalysis(r));
    this.job.total = this.state.repos.length;
    this.job.progress = this.job.total - pending.length;
    if (this.github.starHistory) this.startRanking();
    const commit = async row => {
      signal.throwIfAborted();
      const repo = this.state.repos.find(r => r.id === row.id);
      if (!repo) throw new Error('提交的项目不在榜单');
      const previous = { ...repo };
      Object.assign(repo, row, { analyzed: true, analysisVersion: ANALYSIS_VERSION, readme: undefined, analyzedAt: new Date().toISOString() });
      this.job.progress = this.state.repos.filter(r => !this.needsAnalysis(r)).length;
      try { await this.save(); }
      catch (error) {
        for (const key of Object.keys(repo)) if (!(key in previous)) delete repo[key];
        Object.assign(repo, previous); this.job.progress = this.state.repos.filter(r => !this.needsAnalysis(r)).length;
        throw error;
      }
      this.syncDownloadedMetadata();
    };
    for (let i = 0; i < pending.length; i += 5) {
      signal.throwIfAborted();
      const batch = pending.slice(i, i + 5);
      this.job.message = `读取项目内容 · ${this.job.progress}/${this.job.total}`;
      await Promise.all(batch.map(async r => {
        const content = await this.github.readme(r, signal);
        r.readme = content.text; r.contentSource = content.source;
      }));
      this.job.message = `dsh 正在生成简介、标签与分类 · ${this.job.progress}/${this.job.total}`;
      try {
        const analysis = await this.analyze(batch, signal, { onResult: commit, onUsage: async usage => { addUsage(this.state.usage.analysis, usage); await this.save(); } }); signal.throwIfAborted();
        for (const row of analysis) if (this.needsAnalysis(this.state.repos.find(r => r.id === row.id))) await commit(row);
      } catch (error) {
        if (signal.aborted) throw error;
        for (const row of error.partialResults || []) if (this.needsAnalysis(this.state.repos.find(r => r.id === row.id))) await commit(row);
        this.job.errors.push(`第 ${i + 1}–${i + batch.length} 个待分析项目：${error.message}`);
        // Credential/network errors should not burn another nine model requests.
        if (this.job.progress === 0) throw error;
      }
    }
    if (this.rankingTask) await this.rankingTask; signal.throwIfAborted();
    const complete = this.state.repos.every(r => !this.needsAnalysis(r));
    this.job.status = complete ? 'complete' : 'partial';
    this.job.message = complete ? `已完成 ${this.job.total} 个项目的分析` : `已分析 ${this.job.progress}/${this.job.total}，可重试剩余项目`;
    if (complete) this.state.analyzedAt = new Date().toISOString();
    this.syncDownloadedMetadata(); await this.local.saveIndex(this.state.downloads);
    await this.save();
    if (Object.keys(this.state.downloads).length) {
      try { await this.checkUpdates(); } catch (e) { this.job.errors.push(`本地项目检查：${e.message}`); }
    }
    if (complete && !this.state.inspiration) this.inspirationJob = { status: 'idle', message: '分析结果已展示，可手动点击「灵感乍现」' };
  }
  syncDownloadedMetadata() {
    for (const [id,record] of Object.entries(this.state.downloads)) {
      const matched = this.state.repos.find(r => r.id.toLowerCase() === id.toLowerCase());
      if (!matched) continue;
      const targetId = matched.id;
      if (targetId !== id) {
        this.state.downloads[targetId] = { ...record, ...(this.state.downloads[targetId] || {}) }; delete this.state.downloads[id];
        if (this.state.details[id] && !this.state.details[targetId]) this.state.details[targetId] = this.state.details[id];
        if (this.state.operations[id] && !this.state.operations[targetId]) this.state.operations[targetId] = this.state.operations[id];
      }
      this.state.downloads[targetId].repo = { ...matched, readme:undefined };
      this.state.localRepos = this.state.localRepos.map(r => r.id.toLowerCase() === targetId.toLowerCase() ? { ...r, ...matched, localPath:r.localPath } : r);
    }
  }
  needsAnalysis(repo) { return !repo?.analyzed || repo.analysisVersion !== ANALYSIS_VERSION; }
  isUpdated(id) {
    const record = this.state.downloads[id];
    if (!record || this.find(id).localOnly) return false;
    return Boolean((record.gitCopies || (record.git ? [record.git] : [])).some(g => g.behind > 0) || hasUpdate(record.zip || (record.filename ? record : null), this.state.details[id]));
  }
  async scanDownloads(force = false) {
    if (!force && (this.activeDownloads.size || this.gitTasks.size)) return;
    if (this.demo || (!force && Date.now() - this.scanAt < 15000)) return;
    if (this.scanTask) return this.scanTask;
    this.scanTask = (async () => {
      const result = await this.local.scan(this.state.downloads, [...this.state.repos, ...this.state.localRepos], this.shutdownController.signal);
      // Preserve Git fetch results only while the worktree is at the same commit.
      for (const [id, record] of Object.entries(result.downloads)) {
        const previous = this.state.downloads[id];
        for (const git of record.gitCopies || []) {
          const old = previous?.gitCopies?.find(g => g.path === git.path) || previous?.git;
          if (old?.path === git.path && old.head === git.head) Object.assign(git, { ahead: old.ahead, behind: old.behind, remoteHead: old.remoteHead, checkedAt: old.checkedAt });
        }
        if (record.gitCopies?.length) record.git = record.gitCopies[0];
      }
      this.state.downloads = result.downloads;
      for (const repo of result.repos) {
        const old = this.state.localRepos.find(r => r.id === repo.id);
        if (!old) this.state.localRepos.push(repo);
        else Object.assign(old, { localOnly: repo.localOnly, localKind:repo.localKind, localPath: repo.localPath });
      }
      this.syncDownloadedMetadata();
      this.scanWarnings = result.warnings; this.scanAt = Date.now();
    })().finally(() => { this.scanTask = null; });
    return this.scanTask;
  }
  async analyzeLocal(repo, record, onUsage) {
    if (!this.analyze) throw new Error('dsh 分析服务不可用。');
    if (this.job.status === 'running' || this.inspirationJob.status === 'running' || this.implementationJob.status === 'running') throw new Error('请等待当前 dsh 任务结束，再分析目录中的新项目。');
    const content = record.git || record.folder ? await this.local.content((record.git || record.folder).path) : await this.github.readme(repo, this.shutdownController.signal);
    const input = { ...repo, readme: content.text, contentSource: content.source };
    const commit = async row => {
      if (row.id !== repo.id) throw new Error('本地分析 ID 不匹配。');
      const analyzed = { ...input, ...row, readme: undefined, analyzed: true, analysisVersion: ANALYSIS_VERSION, analyzedAt: new Date().toISOString() };
      const i = this.state.localRepos.findIndex(r => r.id === repo.id);
      if (i >= 0) this.state.localRepos[i] = analyzed; else this.state.localRepos.push(analyzed);
      record.repo = analyzed; await this.save();
    };
    const results = await this.analyze([input], this.shutdownController.signal, { onResult: commit, onUsage });
    for (const row of results || []) if (this.needsAnalysis(this.state.localRepos.find(r => r.id === row.id))) await commit(row);
    if (this.needsAnalysis(this.state.localRepos.find(r => r.id === repo.id))) throw new Error('本地项目分析没有完整提交，请重试。');
  }
  setRanking(mode = 'stars', period = 'week') {
    if (!['stars', 'growth'].includes(mode) || !PERIODS[period]) throw new Error('排序支持累计 Star 或增星趋势；时间维度为周、月。');
    this.mode = mode; this.period = period;
  }
  startRanking(mode = this.mode, period = this.period, refresh = false, metric = 'growth') {
    if (!['growth', 'total'].includes(metric)) throw new Error('图表统计类型无效。');
    this.setRanking(mode, period);
    if (!this.visible) throw new Error('请先点击一键分析。');
    if (this.rankingJob.status === 'running') {
      if (metric !== this.rankingMetric || refresh) this.pendingRanking = { mode, period, refresh, metric };
      return this.rankingJob;
    }
    const cachedOverview = this.overviewsAt().growth[period];
    const fresh = this.state.repos.every(r => this.freshHistory(this.state.starHistories[`${r.id}:${metric === 'total' ? 'all' : 90}`]) || (metric === 'growth' && this.freshHistory(this.state.starHistories[`${r.id}:all`])));
    if (!refresh && fresh && (metric === 'total' ? cachedOverview.cumulativeCovered === cachedOverview.total : cachedOverview.complete)) {
      this.state.rankingAsOf = new Date().toISOString();
      this.rankingJob = {status:'complete',metric,progress:this.state.repos.length,total:this.state.repos.length,errors:[],message:'已复用本地历史缓存，周／月可直接切换'};
      return this.rankingJob;
    }
    if (!this.github.starHistory) throw new Error('Star 历史服务不可用。');
    this.rankingController = new AbortController();
    this.rankingMetric = metric;
    this.rankingJob = { status: 'running', metric, progress: 0, total: this.state.repos.length, errors: [], message: metric === 'total' ? '正在更新累计 Star 历史（首次补全，后续增量更新；3 个项目并发）…' : '正在采集 GitHub 官方增星历史（3 个项目并发）…' };
    this.rankingTask = (async () => {
      const repos = [...this.state.repos], controller = this.rankingController, quota = new AbortController();
      const signal = AbortSignal.any([controller.signal, this.shutdownController.signal, quota.signal]);
      let cursor = 0;
      const worker = async () => {
        while (!signal.aborted && cursor < repos.length) {
          const repo = repos[cursor++];
          try { await this.history(repo.id, metric === 'total' ? 'all' : 90, refresh, signal, metric); this.rankingJob.progress++; }
          catch (e) {
            if (controller.signal.aborted || this.closed) throw e;
            if (!quota.signal.aborted) this.rankingJob.errors.push(`${repo.id}：${e.message}`);
            if (e.rateLimited) quota.abort();
          }
          this.rankingJob.message = `采集 Star 历史 · ${this.rankingJob.progress}/${this.rankingJob.total}`;
        }
      };
      const results = await Promise.allSettled(Array.from({length:Math.min(3,repos.length)}, worker));
      const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
      controller.signal.throwIfAborted(); this.shutdownController.signal.throwIfAborted();
      const overview = this.overviewsAt().growth[this.period];
      this.state.rankingAsOf = new Date().toISOString();
      const covered = metric === 'total' ? overview.cumulativeCovered : overview.covered;
      this.rankingJob.status = covered === overview.total ? 'complete' : 'partial';
      this.rankingJob.message = covered === overview.total ? '官方历史已采集，周／月可直接切换' : `完整${metric === 'total' ? '生命周期' : '增星'}历史覆盖 ${covered}/${overview.total}；缺失数据不绘制曲线`;
      await this.save();
    })().catch(e => { this.rankingJob.status = this.rankingController.signal.aborted || this.closed ? 'cancelled' : 'error'; this.rankingJob.message = e.message; }).finally(() => {
      const pending = this.pendingRanking; this.pendingRanking = null;
      if (pending && !this.closed && !this.rankingController.signal.aborted) this.startRanking(pending.mode, pending.period, pending.refresh, pending.metric);
    });
    return this.rankingJob;
  }
  beginOperation(id, type) {
    this.find(id);
    const operation = { id: randomUUID(), type, status: 'running', phase: type === 'zip' ? '准备下载…' : type === 'pull' ? '检查分支和本地修改…' : '准备克隆…', loaded: 0, total: null, percent: null, error: null, startedAt: new Date().toISOString() };
    this.state.operations[id] = operation; return operation;
  }
  async finishOperation(id, operation, error) {
    Object.assign(operation, { status: error ? 'error' : 'success', error: error?.message || null, phase: error ? operation.phase : '已完成', percent: error ? operation.percent : 100, finishedAt: new Date().toISOString() });
    try { await this.save(); } catch (e) { operation.error = [operation.error, `操作状态保存失败：${e.message}`].filter(Boolean).join('；'); }
  }
  gitOperation(id, action) {
    if (this.closed) return Promise.reject(new Error('服务正在关闭。'));

    if (this.gitTasks.has(id) || this.updateTask) return Promise.reject(new Error('此项目正在操作或检查更新，请稍后重试。'));
    const operation = this.beginOperation(id, action);
    const task = (async () => {
      if (this.demo) throw new Error('演示模式不克隆或拉取项目。');
      if (this.activeDownloads.size) throw new Error('请等待源码 ZIP 下载完成，再进行 Git 操作。');
      await this.save();
      await this.scanDownloads(true);
      const repo = this.find(id); if (repo.localOnly) throw new Error('本地非 GitHub 项目只能分析，不能克隆或拉取。');
      let result;
      if (action === 'clone') {
        if (this.state.downloads[id]?.git) throw new Error('默认目录中已存在克隆项目。');
        result = await this.local.clone(id, this.shutdownController.signal, progress => Object.assign(operation, progress));
      } else if (action === 'pull') {
        const copies = this.state.downloads[id]?.gitCopies || (this.state.downloads[id]?.git ? [this.state.downloads[id].git] : []);
        if (!copies.length) throw new Error('请先克隆项目；ZIP 文件不能执行 Git 拉取。');
        result = { paths: [] };
        for (const git of copies) result.paths.push((await this.local.pull(git, id, this.shutdownController.signal, progress => Object.assign(operation, progress))).path);
        result.path = result.paths[0];
      } else throw new Error('未知 Git 操作。');
      await this.scanDownloads(true); await this.save(); return result;
    })().then(async result => { await this.finishOperation(id, operation); return result; }, async error => { await this.finishOperation(id, operation, error); throw error; }).finally(() => this.gitTasks.delete(id));
    this.gitTasks.set(id, task); return task;
  }
  catalogHash() { return createHash('sha256').update(JSON.stringify(this.state.repos.map(r => ({ id: r.id, analyzedAt: r.analyzedAt, summary: r.summary, capabilities: r.capabilities })))).digest('hex'); }
  canInspire() { return this.state.repos.length === 100 && new Set(this.state.repos.map(r => r.id)).size === 100 && this.state.repos.every(r => !this.needsAnalysis(r)); }
  startInspiration(refresh = false) {
    if (this.closed || !this.visible || !this.analysisFinished || !this.canInspire()) throw new Error('请先完成全部 100 个项目的新版分析。');
    if (this.job.status === 'running') throw new Error('项目分析尚未结束。');
    if (!this.inspire) throw new Error('灵感服务不可用。');
    if (this.inspirationJob.status === 'running' || this.implementationJob.status === 'running') throw new Error('dsh 正在处理灵感或项目。');
    const hash = this.catalogHash();
    const previousIdeas = [...(this.state.ideaHistory || []), ...(this.state.inspiration ? [this.state.inspiration] : [])].slice(-8).map(({title,summary,problem,features})=>({title,summary,problem,features}));
    if (!refresh && this.state.inspiration?.catalogHash === hash) return this.inspirationJob;
    this.state.usage ||= {}; this.state.usage.inspiration = { ...emptyUsage(), startedAt: new Date().toISOString() };
    this.inspirationController = new AbortController();
    this.inspirationJob = { status: 'running', message: 'dsh 正在综合 100 个项目，寻找可做的新项目…' };
    this.inspirationTask = (async () => {
      const result = await this.inspire(this.state.repos, this.inspirationController.signal, { previousIdeas, onUsage: async usage => { addUsage(this.state.usage.inspiration, usage); await this.save(); } });
      this.inspirationController.signal.throwIfAborted();
      if (typeof result?.title !== 'string' || !result.title.trim() || typeof result?.summary !== 'string' || !result.summary.trim()) throw new Error('灵感内容不完整，原构想已保留，请重试。');
      if (isRepeatedIdea(result, previousIdeas)) throw new Error('dsh 返回了相同灵感，原构想已保留，请再换一个。');
      if (this.state.inspiration) this.state.ideaHistory = [...(this.state.ideaHistory || []), this.state.inspiration].slice(-8);
      this.state.inspiration = { ...result, id: randomUUID(), generatedAt: new Date().toISOString(), catalogHash: hash, basedOnCount: 100 };
      this.state.implementation = null; this.implementationJob = { status: 'idle', progress: 0, total: 6, message: '' };
      this.inspirationJob = { status: 'complete', message: '已生成一个有来源依据的新项目灵感' }; await this.save();
    })().catch(error => { this.inspirationJob = { status: this.inspirationController.signal.aborted ? 'cancelled' : 'error', message: error.message }; }).finally(async () => { this.state.usage.inspiration.finishedAt = new Date().toISOString(); try { await this.save(); } catch (e) { this.inspirationJob.message += `；本次用量保存失败：${e.message}`; } });
    return this.inspirationJob;
  }
  startImplementation() {
    if (this.closed || !this.state.inspiration || this.state.inspiration.catalogHash !== this.catalogHash()) throw new Error('请先生成当前榜单的灵感。');
    if (this.demo) throw new Error('演示模式不生成项目文件。');
    if (!this.buildProject) throw new Error('项目撰写服务不可用。');
    if (this.job.status === 'running' || this.inspirationJob.status === 'running' || this.implementationJob.status === 'running') throw new Error('请等待当前 dsh 任务完成。');
    if (this.state.implementation?.ideaId === this.state.inspiration.id) return this.implementationJob;
    this.implementationController = new AbortController();
    const idea = this.state.inspiration; const directory = join(this.root,'generated-projects',`idea-${randomUUID().slice(0,8)}`);
    this.implementationJob = { status: 'running', progress: 0, total: 6, message: 'dsh 正在撰写新项目的 MVP 文件…', path: directory };
    this.implementationTask = (async () => {
      const result = await this.buildProject(idea, directory, this.implementationController.signal, (progress,total) => { this.implementationJob.progress = progress; this.implementationJob.total = total; });
      this.implementationController.signal.throwIfAborted();
      this.state.implementation = { ...result, ideaId: idea.id, generatedAt: new Date().toISOString() };
      this.implementationJob = { ...this.implementationJob, status: 'complete', message: 'MVP 源码已保存，文件与语法检查通过' }; await this.save();
    })().catch(error => { this.implementationJob = { ...this.implementationJob, status: this.implementationController.signal.aborted ? 'cancelled' : 'error', message: error.message }; });
    return this.implementationJob;
  }
  async generatedFiles() {
    const result = this.state.implementation;
    if (!result) throw new Error('新项目尚未生成。');
    const path = resolve(result.path); const location = relative(join(this.root,'generated-projects'), path);
    if (!location || location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error('项目路径无效。');
    return Promise.all(PROJECT_FILES.map(async name => ({ name, content: await readFile(join(path,name)) })));
  }
  cancel() { this.controller?.abort(); this.inspirationController?.abort(); this.implementationController?.abort(); this.rankingController?.abort(); }
  find(id) {
    const repo = this.state.repos.find(r => r.id === id) || this.state.localRepos.find(r => r.id === id) || this.state.downloads[id]?.repo;
    if (!repo) throw new Error('项目不存在，请先分析。');
    return repo;
  }
  async detail(id, refresh = false) {
    const repo = this.find(id);
    if (repo.localOnly) return { ...repo, download: this.state.downloads[id] || null, operation: this.state.operations[id] || null, update: false, commits: [], versionLabel: this.state.downloads[id]?.git?.versionLabel, checkedAt: this.state.downloads[id]?.git?.checkedAt };
    let detail = this.state.details[id];
    if (refresh || !detail || Date.now() - Date.parse(detail.checkedAt) > 600000) {
      try { detail = await this.github.detail(repo, this.shutdownController.signal); this.state.details[id] = detail; await this.save(); }
      catch(e) { if (refresh || this.shutdownController.signal.aborted) throw e; return { ...repo, ...(detail || {}), detailError:e.message, download:this.state.downloads[id] || null, operation:this.state.operations[id] || null, update:this.isUpdated(id) }; }
    }
    return { ...repo, ...detail, download: this.state.downloads[id] || null, operation: this.state.operations[id] || null, update: this.isUpdated(id) };
  }
  async history(id, days = 90, refresh = false, signal, metric = 'growth') {
    const repo = this.find(id);
    if (repo.localOnly) throw new Error('本地项目没有 GitHub Star 历史。');
    if (![30,90,180,365,'all'].includes(days) || !['growth','total'].includes(metric)) throw new Error('历史范围或统计类型无效。');
    const range = metric === 'total' ? 'all' : days, key = `${id}:${range}`;
    let cached = this.state.starHistories[key];
    if (range === 'all' && cached && !hasCumulativeHistory(cached)) {
      let prepared;
      try { prepared = withCumulativeHistory(cached); } catch { /* Retry incomplete history from the source. */ }
      if (prepared) { cached = prepared; this.state.starHistories[key] = cached; await this.saveHistories(); }
    }
    const lifecycle = this.state.starHistories[`${id}:all`];
    if (range !== 'all' && !refresh && this.freshHistory(lifecycle) && hasCumulativeHistory(lifecycle)) return this.recentHistory(lifecycle,days);
    const fresh = !refresh && this.freshHistory(cached) && (range !== 'all' || hasCumulativeHistory(cached));
    let data;
    if (fresh) data = cached;
    else {
      if (!this.historyTasks.has(key)) {
        const task = (async () => {
          const requestSignal = signal ? AbortSignal.any([signal,this.shutdownController.signal]) : this.shutdownController.signal;
          let result = await this.github.starHistory(repo,range,requestSignal,new Date(),{previous:range === 'all' ? cached : undefined});
          requestSignal.throwIfAborted();
          if (range === 'all') {
            try { result = withCumulativeHistory(result,cached); }
            catch (error) { if (hasCumulativeHistory(cached)) throw error; }
          }
          const recentKey = `${id}:90`, oldRecent = this.state.starHistories[recentKey];
          const recent = range === 'all' && hasCumulativeHistory(result) ? this.recentHistory(result,90) : null;
          this.state.starHistories[key] = result;
          if (recent) this.state.starHistories[recentKey] = recent;
          try { await this.saveHistories(); }
          catch (error) {
            if (this.state.starHistories[key] === result) { if (cached) this.state.starHistories[key] = cached; else delete this.state.starHistories[key]; }
            if (recent && this.state.starHistories[recentKey] === recent) { if (oldRecent) this.state.starHistories[recentKey] = oldRecent; else delete this.state.starHistories[recentKey]; }
            throw error;
          }
          return result;
        })().finally(()=>this.historyTasks.delete(key));
        this.historyTasks.set(key,task);
      }
      data = await this.historyTasks.get(key);
    }
    return metric === 'total' ? quantityHistory(data,days) : data;
  }
  freshHistory(history) {
    return history?.metric === 'daily-new-stars' && history.to === new Date().toISOString().slice(0,10) && Date.now()-Date.parse(history.fetchedAt)<6*3600000;
  }
  recentHistory(history,days) {
    const { cumulative, ...metadata } = history;
    const start = Math.max(0,history.points.length-days), points = history.points.slice(start);
    return {...metadata,days,from:points[0]?.date || history.to,points};
  }
  async checkUpdates(onlyId) {
    if (this.gitTasks.size || this.activeDownloads.size) throw new Error('项目正在下载或进行 Git 操作，请稍后再检查更新。');
    if (this.updateTask) return this.updateTask;
    this.updateTask = (async () => {
      this.localJob = { status: 'running', message: '扫描默认目录并检查项目…' };
      await this.scanDownloads(true);
      const errors = []; let analyzedCount = 0, githubLimited = false;
      for (const id of Object.keys(this.state.downloads).filter(id => !onlyId || id === onlyId)) {
        if (this.shutdownController.signal.aborted) break;
        try {
          let repo = this.find(id); const record = this.state.downloads[id];
          this.localJob.message = `读取内容并检查 · ${id}`;
          if (repo.localKind === 'archive') continue;
          if (!this.state.repos.some(r => r.id === id) && this.needsAnalysis(repo)) {
            if (!repo.localOnly && this.github.repository && !githubLimited) {
              try { repo = { ...repo, ...await this.github.repository(id, this.shutdownController.signal), id }; }
              catch (e) { errors.push(`${id} 元数据：${e.message}`); githubLimited = Boolean(e.rateLimited); }
            }
            await this.analyzeLocal(repo, record, !this.analysisFinished && this.state.usage?.analysis ? async usage => { addUsage(this.state.usage.analysis, usage); await this.save(); } : undefined); analyzedCount++;
          }
          if (!repo.localOnly) {
            if (!githubLimited) {
              try { await this.detail(id, true); }
              catch (e) { errors.push(`${id} Release：${e.message}`); githubLimited = Boolean(e.rateLimited); }
            }
            for (const git of record.gitCopies || (record.git ? [record.git] : [])) Object.assign(git, await this.local.check(git, id, this.shutdownController.signal));
            if (record.gitCopies?.length) record.git = record.gitCopies[0];
          }
        } catch (e) { errors.push(`${id}：${e.message}`); }
      }
      await this.save(); this.localJob = { status: errors.length ? 'partial' : 'complete', message: errors.length ? `部分检查未完成（${errors.length} 项提示）：${errors.slice(0, 3).join('；')}` : `目录扫描、内容分析与更新检查完成${analyzedCount ? `，已分析 ${analyzedCount} 个目录项目，可在「已下载」查看` : ''}`, errors };
      return { errors, analyzedCount, count: this.snapshot().updatesCount };
    })();
    try { return await this.updateTask; } finally { this.updateTask = null; if (this.localJob.status === 'running') this.localJob = { status: 'error', message: '目录检查未完成，请重试。' }; }
  }
  download(id) {
    if (this.closed) return Promise.reject(new Error('服务正在关闭。'));
    if (this.downloadTasks.has(id)) return Promise.reject(new Error('这个项目正在下载。'));
    const operation = this.beginOperation(id, 'zip');
    const task = this.performDownload(id, operation).then(async result => { await this.finishOperation(id, operation); return result; }, async error => { await this.finishOperation(id, operation, error); throw error; }).finally(() => this.downloadTasks.delete(id));
    this.downloadTasks.set(id, task);
    return task;
  }
  async performDownload(id, operation) {
    if (this.demo) throw new Error('演示模式不下载文件，请使用正式启动入口。');
    if (this.gitTasks.size || this.updateTask) throw new Error('请等待 Git 操作或更新检查完成后再下载。');
    if (this.activeDownloads.has(id)) throw new Error('这个项目正在下载。');
    this.activeDownloads.add(id);
    let tmp;
    try {
      if (this.find(id).localOnly) throw new Error('本地非 GitHub 项目只能分析，不能下载。');
      await this.save();
      const detail = await this.detail(id, true);
      if (!detail.archiveUrl || !detail.version) throw new Error('这个项目没有可下载的 Release 或提交。');
      const dir = join(this.root, 'downloads'); await mkdir(dir, { recursive: true });
      const name = `${id.replace('/', '--')}-${detail.version.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`;
      const destination = join(dir, name); tmp = `${destination}.${randomUUID()}.part`;
      const response = await this.github.fetcher(detail.archiveUrl, { signal: AbortSignal.any([this.shutdownController.signal, AbortSignal.timeout(600000)]), headers: { 'User-Agent': 'DSH-WhatsNew/0.1' } });
      if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}），请重试。`);
      const length = Number(response.headers.get('content-length'));
      const encoded = response.headers.get('content-encoding');
      operation.total = (!encoded || encoded === 'identity') && Number.isSafeInteger(length) && length > 0 ? length : null;
      operation.phase = '下载 ZIP…';
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        operation.loaded += chunk.length;
        operation.percent = operation.total ? Math.min(99, Math.floor(operation.loaded / operation.total * 100)) : null;
        callback(null, chunk);
      } });
      // Mark downloaded only after the full archive is written successfully.
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(tmp, { mode: 0o600 }), { signal: this.shutdownController.signal });
      operation.phase = '保存并校验文件…';
      const fileStat = await stat(tmp);
      if (operation.total && operation.loaded !== operation.total) throw new Error('下载不完整，已接收大小与服务器声明不一致，请重试。');
      if (!fileStat.size) throw new Error('下载文件为空，请重试。');
      await rename(tmp, destination); tmp = null;
      const zip = { version: detail.version, versionLabel: detail.versionLabel, downloadedAt: new Date().toISOString(), filename: name, size: fileStat.size };
      this.state.downloads[id] = { ...this.state.downloads[id], ...zip, zip, repo: { ...this.find(id), readme: undefined } };
      await this.local.saveIndex(this.state.downloads); await this.save();
      return { ...this.state.downloads[id], path: destination };
    } finally {
      if (tmp) await unlink(tmp).catch(() => {});
      this.activeDownloads.delete(id);
    }
  }
  async file(id, res) {
    const record = this.state.downloads[id]?.zip || this.state.downloads[id];
    if (!record || record.filename !== record.filename.replace(/[\/\\]/g, '')) throw new Error('下载记录不存在。');
    const path = join(this.root, 'downloads', record.filename); await stat(path);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${record.filename}"` });
    await pipeline(createReadStream(path), res);
  }
  async close() {
    this.closed = true; this.cancel(); this.shutdownController.abort();
    await Promise.allSettled([this.analysisTask, this.updateTask, this.inspirationTask, this.implementationTask, this.rankingTask, this.scanTask]);
    await Promise.allSettled([...this.downloadTasks.values(), ...this.historyTasks.values(), ...this.gitTasks.values()]); await this.saveQueue;
  }
}
