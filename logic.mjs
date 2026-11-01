/** 没有依赖的游戏规则，便于在浏览器和测试中共享。 */
export const ROUND_MS = 20_000;
export const MAX_WORD_CHARS = 24;

export function cleanWord(value) {
  return String(value ?? '').trim();
}
export function validWord(value) {
  const size = Array.from(cleanWord(value)).length;
  return size >= 1 && size <= MAX_WORD_CHARS;
}
export function remainingMs(startedAt, estimatedServerNow, durationMs = ROUND_MS) {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return durationMs;
  return Math.max(0, startedAt + durationMs - estimatedServerNow);
}
export function roundKey(game, round) {
  return `g${game}r${round}`;
}
export function everyoneSubmitted(players, submitted, capacity) {
  const people = Object.keys(players || {});
  return people.length === capacity && people.every(uid => submitted?.[uid] === true);
}
export function evaluateRound(players, answers, capacity) {
  const rows = Object.entries(players || {}).map(([uid, player]) => {
    const text = answers?.[uid];
    return {uid, name: player.name, word: typeof text === 'string' ? text : null, timedOut: typeof text !== 'string'};
  });
  const matched = rows.length === capacity && rows.every(p => !p.timedOut) && rows.every(p => p.word === rows[0].word);
  return { rows, matched, timedOut: rows.some(p => p.timedOut), word: matched ? rows[0].word : null };
}
