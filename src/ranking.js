export const PERIODS = { week: 7, month: 30 };
export function windowDates(period = 'week', now = new Date()) {
  const days = PERIODS[period]; if (!days) throw new Error('时间维度支持周、月。');
  const today = Date.parse(now.toISOString().slice(0, 10));
  return Array.from({ length: days }, (_, i) => new Date(today - (days - i) * 86400000).toISOString().slice(0, 10));
}
export function calculateOverview(repos, histories, { period = 'week', mode = 'stars', now = new Date() } = {}) {
  const dates = windowDates(period, now), values = {}, series = {};
  for (const repo of repos) {
    const history = histories[`${repo.id}:90`];
    const source = new Map((history?.metric === 'daily-new-stars' && history.to === now.toISOString().slice(0, 10) ? history.points : []).map(p => [p.date, p.stars]));
    const created = /^\d{4}-\d{2}-\d{2}T/.test(repo.createdAt || '') ? repo.createdAt.slice(0, 10) : null;
    // A repository cannot receive stars before its verified creation date.
    // Missing days after creation still remain unknown.
    const firstSource = [...source.keys()].sort()[0];
    if (created && firstSource) for (const date of dates) if (date < created && date < firstSource && !source.has(date)) source.set(date, 0);
    series[repo.id] = source;
    const valid = dates.every(d => Number.isSafeInteger(source.get(d)) && source.get(d) >= 0);
    values[repo.id] = valid ? dates.reduce((sum, d) => sum + source.get(d), 0) : null;
  }
  const covered = repos.filter(r => values[r.id] != null);
  const sorted = [...repos].sort((a, b) => mode === 'growth' ? (values[b.id] ?? -1) - (values[a.id] ?? -1) || (b.stars ?? -1) - (a.stars ?? -1) : (b.stars ?? -1) - (a.stars ?? -1));
  const ranks = Object.fromEntries(sorted.filter(r => mode !== 'growth' || values[r.id] != null).map((r, i) => [r.id, i + 1]));
  const trend = covered.length ? dates.map(date => ({ date, stars: covered.reduce((n, r) => n + series[r.id].get(date), 0) })) : [];
  const max = Math.max(1, ...repos.map(r => r.stars || 0)), width = max / 8;
  const histogram = Array.from({ length: 8 }, (_, i) => ({ from: Math.ceil(width * i), to: i === 7 ? max : Math.ceil(width * (i + 1)), count: 0 }));
  repos.filter(r => Number.isFinite(r.stars)).forEach(r => histogram[Math.min(7, Math.floor(r.stars / width))].count++);
  const categories = {};
  for (const r of repos) { const category = r.analyzed ? r.category || '待分类' : '待分析'; categories[category] = (categories[category] || 0) + 1; }
  const fetched = covered.map(r => histories[`${r.id}:90`]?.fetchedAt).filter(Boolean).sort();
  return { mode, period, from: dates[0], to: dates.at(-1), values, ranks, trend, projectTrends: repos.map(r => ({ id: r.id, name: r.name, stars: r.stars, growth: values[r.id], complete: values[r.id] != null, points: dates.map(date => ({ date, stars: series[r.id].get(date) ?? null })) })), histogram, categories, covered: covered.length, total: repos.length, complete: covered.length === repos.length && repos.length > 0,
    fetchedAt: fetched[0] || null, scope: '累计 Star 前 100 项目内排序', metric: '完整 7／30 天的新增 Star（非净增长）', source: 'GitHub 官方 Star 历史，日界限沿用来源' };
}
