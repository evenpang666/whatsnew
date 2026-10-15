const dayMs = 86400000;
const cumulativeVersion = 1;

export function hasCumulativeHistory(history) {
  const index = history?.cumulative, from = String(history?.createdAt || '').slice(0,10);
  const length = (Date.parse(history?.to) - Date.parse(from)) / dayMs + 1;
  return history?.metric === 'daily-new-stars' && index?.version === cumulativeVersion && index.from === from && index.to === history.to && index.fetchedAt === history.fetchedAt &&
    Number.isSafeInteger(length) && length > 0 && index.points?.length === length && history.points?.length === length &&
    index.points[0]?.date === from && index.points.at(-1)?.date === history.to && Number.isSafeInteger(index.points.at(-1)?.stars) && index.points.at(-1).stars >= 0;
}

// Called when history changes, rather than each time a chart window is read.
export function withCumulativeHistory(history, previous) {
  if (hasCumulativeHistory(history)) return history;
  const start = Date.parse(String(history.createdAt || '').slice(0,10)), end = Date.parse(history.to);
  if (history.metric !== 'daily-new-stars' || !Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('数量趋势缺少项目创建日期。');
  const source = new Map(history.points.map(p => [p.date,p.stars]));
  let points = [], total = 0, time = start;
  // The incremental fetch replaces everything from updatedFrom onward. Its
  // earlier prefix is unchanged, so retain the already computed prefix sums.
  const update = Date.parse(history.updatedFrom);
  if (hasCumulativeHistory(previous) && previous.cumulative.from === new Date(start).toISOString().slice(0,10) && update > start && update <= Date.parse(previous.to) + dayMs) {
    const prefixLength = (update - start) / dayMs;
    points = previous.cumulative.points.slice(0,prefixLength);
    total = points.at(-1)?.stars || 0; time = update;
  }
  for (; time <= end; time += dayMs) {
    const date = new Date(time).toISOString().slice(0,10), count = source.get(date);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`数量趋势需要完整生命周期历史；${date} 数据缺失，请刷新重试。`);
    total += count;
    if (!Number.isSafeInteger(total)) throw new Error('累计 Star 数量超出安全范围。');
    points.push({date,stars:total});
  }
  return { ...history, cumulative: {version:cumulativeVersion, from:new Date(start).toISOString().slice(0,10), to:history.to, fetchedAt:history.fetchedAt, points} };
}

// History counts star creations; GitHub supplies no daily unstar totals.
export function quantityHistory(history, days = 'all') {
  const start = Date.parse(String(history.createdAt || '').slice(0,10)), end = Date.parse(history.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('数量趋势缺少项目创建日期。');
  const from = days === 'all' ? start : Math.max(start,end-(days-1)*dayMs);
  const cached = withCumulativeHistory(history), points = cached.cumulative.points.slice((from-start)/dayMs);
  const { cumulative, ...metadata } = history;
  return { ...metadata, points, days, from:new Date(from).toISOString().slice(0,10), metric:'cumulative-stars-created',
    note:'每日数量为从项目创建起累计获得的 Star，依据完整官方每日新增历史求和；来源不提供逐日取消星标，不能代表当日净 Star 存量。当天数据尚未结束，日界限沿用 GitHub。' };
}
