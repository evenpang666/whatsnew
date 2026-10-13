const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function fullWindow(length) {
  if (!Number.isInteger(length) || length < 2) throw new Error('图表至少需要两个日期。');
  return { start: 0, end: length - 1 };
}
export function zoomWindow(window, length, factor, anchor = .5) {
  const full = fullWindow(length);
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) throw new Error('缩放参数无效。');
  const span = window.end - window.start, next = clamp(span / factor, 1, full.end);
  anchor = clamp(anchor, 0, 1);
  const point = window.start + span * anchor;
  const start = clamp(point - next * anchor, 0, full.end - next);
  return { start, end: start + next };
}
export function panWindow(window, length, delta) {
  const full = fullWindow(length);
  if (!Number.isFinite(delta)) throw new Error('平移参数无效。');
  const span = clamp(window.end - window.start, 1, full.end);
  const start = clamp(window.start + delta, 0, full.end - span);
  return { start, end: start + span };
}
