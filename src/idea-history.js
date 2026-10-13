const normalize = value => typeof value === 'string' ? value.trim().replace(/\s+/g,'') : '';
export function isRepeatedIdea(next, previous = []) {
  const title=normalize(next?.title), summary=normalize(next?.summary), problem=normalize(next?.problem);
  const features=Array.isArray(next?.features)?next.features.map(normalize).sort().join('|'):'';
  return previous.some(old => (title && title===normalize(old.title)) || (summary && summary===normalize(old.summary)) ||
    (problem && features && problem===normalize(old.problem) && Array.isArray(old.features) && features===old.features.map(normalize).sort().join('|')));
}
