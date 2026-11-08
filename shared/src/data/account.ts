/** 계정 레벨 (판 밖 성장, 실력에는 영향 없음). 수치는 여기서 조정한다. */
export const ACCOUNT_XP = {
  base: 60, // 판 참가
  placement: [0, 140, 100, 80, 65, 50, 40, 30, 20, 10, 0], // 순위 보너스 (인덱스 = 순위)
  perKill: 25,
  perSurvivalMinute: 10,
};

/** 레벨 L에서 L+1로 가는 데 필요한 경험치 */
export function accountXpToNext(level: number): number {
  return 300 + (level - 1) * 150;
}

export function accountXpGain(placement: number, kills: number, survivalSec: number): number {
  const p = ACCOUNT_XP.placement[Math.max(1, Math.min(10, placement))] ?? 0;
  return Math.round(ACCOUNT_XP.base + p + kills * ACCOUNT_XP.perKill + (survivalSec / 60) * ACCOUNT_XP.perSurvivalMinute);
}

/** 누적 경험치 → 레벨과 현재 레벨 진행도 */
export function accountLevel(totalXp: number): { level: number; into: number; need: number } {
  let level = 1, rest = Math.max(0, Math.floor(totalXp));
  while (rest >= accountXpToNext(level) && level < 999) { rest -= accountXpToNext(level); level++; }
  return { level, into: rest, need: accountXpToNext(level) };
}
