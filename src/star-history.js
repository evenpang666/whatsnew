const dayMs = 86400000;
// History counts star creations; GitHub supplies no daily unstar totals.
export function quantityHistory(history, days = 'all') {
  const start = Date.parse(String(history.createdAt || '').slice(0,10)), end = Date.parse(history.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('数量趋势缺少项目创建日期。');
  const source = new Map(history.points.map(p => [p.date,p.stars]));
  const from = days === 'all' ? start : Math.max(start,end-(days-1)*dayMs);
  const points = []; let total = 0;
  for(let time=start;time<=end;time+=dayMs) {
    const date=new Date(time).toISOString().slice(0,10), count=source.get(date);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`数量趋势需要完整生命周期历史；${date} 数据缺失，请刷新重试。`);
    total+=count; if(time>=from)points.push({date,stars:total});
  }
  return { ...history, points, days, from:new Date(from).toISOString().slice(0,10), metric:'cumulative-stars-created',
    note:'每日数量为从项目创建起累计获得的 Star，依据完整官方每日新增历史求和；来源不提供逐日取消星标，不能代表当日净 Star 存量。当天数据尚未结束，日界限沿用 GitHub。' };
}
