import { describe, it, expect } from 'vitest';
import { SqliteStore, FirestoreStore, applyResult, type AccountStore } from '../src/db';

/** 저장소 공통 계약: 생성 → 로드 → 수정 저장 → 다시 로드 */
async function contract(store: AccountStore) {
  const a = await store.create('테스터');
  expect(a.token).toMatch(/^[a-f0-9]{48}$/);
  expect(a.credits).toBeGreaterThan(0);
  const loaded = (await store.load(a.token))!;
  expect(loaded.name).toBe('테스터');
  applyResult(loaded, 'rail', 1, 3, 150);
  loaded.owned.push('pal:rail:1');
  loaded.loadout.palette.rail = 1;
  await store.save(loaded);
  const again = (await store.load(a.token))!;
  expect(again.credits).toBe(a.credits + 150);
  expect(again.stats.wins).toBe(1);
  expect(again.stats.heroes.rail).toEqual({ games: 1, wins: 1, kills: 3 });
  expect(again.owned).toContain('pal:rail:1');
  expect(again.loadout.palette.rail).toBe(1);
  expect(await store.load('0'.repeat(48))).toBeNull();
  expect(await store.load('잘못된 토큰')).toBeNull();
  await store.recordMatch('m' + Date.now(), '테스터', 10, 250);
}

describe('계정 저장소', () => {
  it('SQLite', async () => {
    const s = await SqliteStore.open(':memory:');
    await contract(s);
    await s.close();
  });
  it.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firestore (에뮬레이터)', async () => {
    const s = await FirestoreStore.open({ projectId: 'demo-neon', prefix: 'test_' });
    await contract(s);
    await s.close();
  });
});
