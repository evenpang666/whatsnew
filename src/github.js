import { GitHubToken } from './github-token.js';
export const CATEGORIES = ['人工智能', '开发工具', '科研学术', '摄影影像', '艺术设计', '学习资源', '效率工具', '其他'];
export class GitHubClient {
  constructor({ root = process.cwd(), token = process.env.GITHUB_TOKEN, fetcher = fetch } = {}) {
    this.token = token; this.credentials = new GitHubToken(root, token);
    this.fetcher = fetcher;
  }
  async api(path, signal, version = '2022-11-28') {
    const token = await this.credentials.get();
    const response = await this.fetcher(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-WhatsNew/0.1', 'X-GitHub-Api-Version': version, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const reset = response.headers.get('x-ratelimit-reset');
        const error = new Error(`GitHub 请求受限。${reset ? `请在 ${new Date(Number(reset) * 1000).toLocaleTimeString('zh-CN')} 后重试，或` : '请稍后重试，或'}在页面配置 GitHub Token（config/github.token）提高额度。`);
        error.rateLimited = true; throw error;
      }
      throw new Error(`GitHub 返回 ${response.status}，请检查网络或 Token。`);
    }
    return response.json();
  }
  async top(signal) {
    // At least 100 results above the floor yields the same global Top 100,
    // while avoiding GitHub timeouts across millions of low-star repos.
    const result = await this.api('/search/repositories?q=stars:%3E10000+is:public+fork:false&sort=stars&order=desc&per_page=100', signal);
    if (result?.items?.length !== 100 || result.incomplete_results) throw new Error('GitHub 未返回完整前 100 榜单，请稍后重试。');
    return result.items.map((r, i) => ({
      id: r.full_name, name: r.name, owner: r.owner.login, url: r.html_url,
      description: r.description || '', stars: r.stargazers_count, forks: r.forks_count,
      issues: r.open_issues_count, language: r.language, topics: r.topics || [],
      branch: r.default_branch, createdAt: r.created_at, pushedAt: r.pushed_at, license: r.license?.spdx_id || null,
      rank: i + 1, analyzed: false
    }));
  }
  async repository(id, signal) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(id)) throw new Error('GitHub 项目标识无效。');
    const r = await this.api(`/repos/${id}`, signal);
    if (!r) throw new Error('GitHub 仓库不存在或没有访问权限。');
    return { id: r.full_name, name: r.name, owner: r.owner.login, url: r.html_url, description: r.description || '', stars: r.stargazers_count, forks: r.forks_count, issues: r.open_issues_count, language: r.language, topics: r.topics || [], branch: r.default_branch, createdAt: r.created_at, pushedAt: r.pushed_at, license: r.license?.spdx_id || null, analyzed: false };
  }
  async readme(repo, signal) {
    try {
      const response = await this.fetcher(`https://raw.githubusercontent.com/${repo.id}/${encodeURIComponent(repo.branch)}/README.md`, {
        signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(12000)])
      });
      if (!response.ok) return { text: '', source: '仅仓库描述与 Topics（README 不可用）' };
      // Stream a bounded excerpt: huge READMEs never exhaust host memory.
      const reader = response.body.getReader();
      const chunks = []; let length = 0;
      try { while (length < 18000) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); length += value.length; } }
      finally { await reader.cancel(); }
      return { text: Buffer.concat(chunks).toString('utf8').slice(0, 10000), source: '仓库描述、Topics 与 README' };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { text: '', source: '仅仓库描述与 Topics（README 请求失败）' };
    }
  }
  async detail(repo, signal) {
    const [releases, commits] = await Promise.all([
      this.api(`/repos/${repo.id}/releases?per_page=100`, signal),
      this.api(`/repos/${repo.id}/commits?sha=${encodeURIComponent(repo.branch)}&per_page=5`, signal)
    ]);
    const releaseList = releases || [];
    const latest = releaseList.find(r => !r.draft && !r.prerelease) || null;
    const commit = commits?.[0];
    const version = latest ? `release:${latest.tag_name}` : commit ? `commit:${commit.sha}` : null;
    return {
      version, versionLabel: latest?.tag_name || commit?.sha.slice(0, 7) || '暂无版本',
      release: latest ? { name: latest.name || latest.tag_name, body: latest.body || '维护者未填写 Release 简介。', publishedAt: latest.published_at, url: latest.html_url } : null,
      commits: (commits || []).map(c => ({ sha: c.sha, message: c.commit.message, date: c.commit.author?.date, url: c.html_url })),
      releaseDownloads: releaseList.length ? releaseList.reduce((sum, r) => sum + r.assets.reduce((n, a) => n + a.download_count, 0), 0) : null,
      downloadScope: releaseList.length === 100 ? '最近 100 个 Release 的资产下载量' : '公开 Release 的资产下载量',
      assets: (latest?.assets || []).map(a => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url })),
      archiveUrl: latest ? `https://codeload.github.com/${repo.id}/zip/refs/tags/${encodeURIComponent(latest.tag_name)}` : commit ? `https://codeload.github.com/${repo.id}/zip/${commit.sha}` : null,
      checkedAt: new Date().toISOString()
    };
  }
  async starHistory(repo, days = 90, signal, now = new Date()) {
    if (![30, 90, 180, 365, 'all'].includes(days)) throw new Error('历史查询范围支持 30、90、180、365 天或完整生命周期。');
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const lifecycle = days === 'all';
    let createdAt = repo.createdAt;
    if (lifecycle && !createdAt) createdAt = (await this.repository(repo.id, signal)).createdAt;
    const created = Date.parse(String(createdAt || '').slice(0,10));
    if (lifecycle && (!Number.isFinite(created) || created > end)) throw new Error('无法确定项目创建日期，请稍后重试。');
    const start = lifecycle ? created : end - (days - 1) * 86400000;
    const points = new Map();
    // GitHub returns newest weeks first, max 30 weeks per page.
    // Fetch until the earliest requested day is covered, not a fixed page count.
    for (let page = 1; page <= 100; page++) {
      const rows = await this.api(`/repos/${repo.id}/stargazers/history?per_page=30&page=${page}`, signal, '2026-03-10');
      if (!Array.isArray(rows)) throw new Error('GitHub 暂未提供这个项目的 Star 历史。');
      let earliest = Infinity;
      for (const row of rows) {
        if (!Number.isFinite(row.week) || !Number.isSafeInteger(row.total) || row.total < 0 || !Array.isArray(row.days) || row.days.length !== 7 || row.days.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('GitHub Star 历史数据格式无效，请稍后重试。');
        const week = row.week * 1000; earliest = Math.min(earliest, week);
        row.days.forEach((stars, i) => {
          const time = week + i * 86400000;
          // Preserve the source calendar-day label; do not shift to local time.
          const day = Date.parse(new Date(time).toISOString().slice(0, 10));
          if (day >= start && day <= end) points.set(day, { date: new Date(day).toISOString().slice(0, 10), stars });
        });
      }
      if (rows.length < 30 || earliest <= start) break;
      if (page === 100) throw new Error('GitHub 未返回完整请求时段的 Star 历史，请稍后重试。');
    }
    return {
      points: [...points.entries()].sort(([a], [b]) => a - b).map(([, value]) => value),
      days, createdAt: lifecycle ? createdAt : repo.createdAt, metric: 'daily-new-stars', source: 'GitHub 官方 Star 历史',
      sourceUrl: 'https://docs.github.com/en/rest/activity/starring#get-repository-star-history',
      from: new Date(start).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10),
      fetchedAt: now.toISOString(),
      note: '按 GitHub 历史接口统计每天创建的 Star，不代表每日净增长或当日累计 Star；当天数据尚未结束，日界限沿用 GitHub。'
    };
  }
}
export function hasUpdate(download, detail) {
  return Boolean(download?.version && detail?.version && download.version !== detail.version);
}
