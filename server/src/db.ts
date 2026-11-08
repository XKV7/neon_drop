import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_LOADOUT, STARTING_CREDITS, accountXpGain, type HeroId, type Loadout, type Profile } from '@neon/shared';

export interface Account { token: string; name: string; credits: number; owned: string[]; loadout: Loadout; stats: Profile['stats'] }

/**
 * 게스트 계정 저장소. 로컬/도커는 SQLite, Firebase(Cloud Run)는 Firestore.
 * 서버 인스턴스는 하나이므로 접속 중인 계정은 메모리 객체가 기준이고, 저장소에는 통째로 기록한다.
 */
export interface AccountStore {
  readonly kind: string;
  load(token: string): Promise<Account | null>;
  create(name: string): Promise<Account>;
  save(a: Account): Promise<void>;
  recordMatch(id: string, winner: string, players: number, length: number): Promise<void>;
  close(): Promise<void>;
}

export const TOKEN_RE = /^[a-f0-9]{48}$/;

export function newAccount(name: string): Account {
  return {
    token: randomBytes(24).toString('hex'), name, credits: STARTING_CREDITS, owned: [], loadout: structuredClone(DEFAULT_LOADOUT),
    stats: { games: 0, wins: 0, kills: 0, bestKills: 0, heroes: {} },
  };
}

/** 저장된 값이 일부 빠져 있어도 안전하게 복원 */
export function normalizeAccount(token: string, d: Partial<Account>): Account {
  return {
    token, name: String(d.name ?? '게스트'), credits: Number(d.credits ?? 0) | 0, owned: Array.isArray(d.owned) ? d.owned.map(String) : [],
    loadout: { ...structuredClone(DEFAULT_LOADOUT), ...(d.loadout ?? {}) },
    stats: { games: 0, wins: 0, kills: 0, bestKills: 0, heroes: {}, ...(d.stats ?? {}) },
  };
}

/** 판 결과 반영 (메모리 객체 수정, 저장은 호출 측) */
export function applyResult(a: Account, heroId: HeroId, placement: number, kills: number, credits: number, survivalSec = 0): number {
  const xp = accountXpGain(placement, kills, survivalSec);
  a.stats.xp = (a.stats.xp ?? 0) + xp;
  a.credits += credits;
  a.stats.games++;
  if (placement === 1) a.stats.wins++;
  a.stats.kills += kills;
  a.stats.bestKills = Math.max(a.stats.bestKills, kills);
  const hr = a.stats.heroes[heroId] ?? { games: 0, wins: 0, kills: 0 };
  hr.games++; if (placement === 1) hr.wins++; hr.kills += kills;
  a.stats.heroes[heroId] = hr;
  return xp;
}

export function toProfile(a: Account): Profile {
  return { name: a.name, credits: a.credits, owned: a.owned, loadout: a.loadout, stats: a.stats };
}

// ───────────────── SQLite ─────────────────
export class SqliteStore implements AccountStore {
  readonly kind = 'sqlite';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  static async open(path: string): Promise<SqliteStore> {
    const { default: Database } = await import('better-sqlite3');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const s = new SqliteStore();
    s.db = new Database(path);
    s.db.pragma('journal_mode = WAL');
    s.db.exec(`CREATE TABLE IF NOT EXISTS accounts (
      token TEXT PRIMARY KEY, name TEXT NOT NULL, credits INTEGER NOT NULL, owned TEXT NOT NULL, loadout TEXT NOT NULL, stats TEXT NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
    s.db.exec(`CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, created INTEGER NOT NULL, winner TEXT, players INTEGER, length REAL)`);
    return s;
  }

  async load(token: string) {
    if (!TOKEN_RE.test(token)) return null;
    const row = this.db.prepare('SELECT * FROM accounts WHERE token = ?').get(token) as { name: string; credits: number; owned: string; loadout: string; stats: string } | undefined;
    if (!row) return null;
    return normalizeAccount(token, { name: row.name, credits: row.credits, owned: JSON.parse(row.owned), loadout: JSON.parse(row.loadout), stats: JSON.parse(row.stats) });
  }

  async create(name: string) {
    const a = newAccount(name);
    const now = Date.now();
    this.db.prepare('INSERT INTO accounts (token, name, credits, owned, loadout, stats, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.token, a.name, a.credits, JSON.stringify(a.owned), JSON.stringify(a.loadout), JSON.stringify(a.stats), now, now);
    return a;
  }

  async save(a: Account) {
    this.db.prepare('UPDATE accounts SET name = ?, credits = ?, owned = ?, loadout = ?, stats = ?, updated = ? WHERE token = ?')
      .run(a.name, a.credits, JSON.stringify(a.owned), JSON.stringify(a.loadout), JSON.stringify(a.stats), Date.now(), a.token);
  }

  async recordMatch(id: string, winner: string, players: number, length: number) {
    this.db.prepare('INSERT OR REPLACE INTO matches (id, created, winner, players, length) VALUES (?, ?, ?, ?, ?)').run(id, Date.now(), winner, players, length);
  }

  async close() { this.db.close(); }
}

// ───────────────── Firestore ─────────────────
/** 컬렉션: accounts/{토큰}, matches/{매치 id}. 클라이언트 직접 접근은 firestore.rules로 전부 차단하고 서버만 Admin SDK로 접근한다. */
export class FirestoreStore implements AccountStore {
  readonly kind = 'firestore';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fs: any;
  private prefix = '';

  static async open(opts: { projectId?: string; prefix?: string; serviceAccount?: ServiceAccountJson | null }): Promise<FirestoreStore> {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const sa = opts.serviceAccount;
    const app = getApps()[0] ?? initializeApp(sa
      ? { credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }), projectId: opts.projectId || sa.project_id }
      : opts.projectId ? { projectId: opts.projectId } : undefined);
    const s = new FirestoreStore();
    s.fs = getFirestore(app);
    s.fs.settings({ ignoreUndefinedProperties: true });
    s.prefix = opts.prefix ?? '';
    return s;
  }

  private col(name: string) { return this.fs.collection(this.prefix + name); }

  async load(token: string) {
    if (!TOKEN_RE.test(token)) return null;
    const snap = await this.col('accounts').doc(token).get();
    return snap.exists ? normalizeAccount(token, snap.data()) : null;
  }

  async create(name: string) {
    const a = newAccount(name);
    const now = Date.now();
    await this.col('accounts').doc(a.token).create({ name: a.name, credits: a.credits, owned: a.owned, loadout: a.loadout, stats: a.stats, created: now, updated: now });
    return a;
  }

  async save(a: Account) {
    await this.col('accounts').doc(a.token).set({ name: a.name, credits: a.credits, owned: a.owned, loadout: a.loadout, stats: a.stats, updated: Date.now() }, { merge: true });
  }

  async recordMatch(id: string, winner: string, players: number, length: number) {
    await this.col('matches').doc(id).set({ created: Date.now(), winner, players, length });
  }

  async close() { await this.fs.terminate(); }
}

export interface ServiceAccountJson { project_id: string; client_email: string; private_key: string }

/**
 * 서비스 계정 키 (Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키).
 * Render 같은 외부 호스팅에서 환경 변수 FIREBASE_SERVICE_ACCOUNT 에 JSON 그대로 또는 base64로 넣는다.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccountJson | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (!text.startsWith('{')) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { return null; }
  }
  try {
    const j = JSON.parse(text);
    if (!j.project_id || !j.client_email || !j.private_key) return null;
    // 환경 변수에 붙여 넣으며 줄바꿈이 \n 문자열로 바뀐 경우 복원
    return { project_id: j.project_id, client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, '\n') };
  } catch { return null; }
}

/** 환경 변수로 저장소 선택: STORE=firestore | sqlite(기본) */
export async function openStore(env: NodeJS.ProcessEnv, defaultDbPath: string): Promise<AccountStore> {
  const kind = (env.STORE ?? 'sqlite').toLowerCase();
  if (kind === 'firestore') {
    const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    if (env.FIREBASE_SERVICE_ACCOUNT && !sa) console.error('⚠ FIREBASE_SERVICE_ACCOUNT 값을 읽지 못했습니다. 서비스 계정 JSON 전체(또는 base64)를 넣었는지 확인하세요.');
    // 자격 증명이 전혀 없으면(Cloud Run·에뮬레이터도 아님) 서버가 죽지 않도록 SQLite로 대체
    const ambient = !!(env.K_SERVICE || env.GOOGLE_APPLICATION_CREDENTIALS || env.FIRESTORE_EMULATOR_HOST);
    if (sa || ambient) return FirestoreStore.open({ projectId: env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT, prefix: env.FIRESTORE_PREFIX, serviceAccount: sa });
    console.error('⚠ STORE=firestore 이지만 자격 증명(FIREBASE_SERVICE_ACCOUNT)이 없어 SQLite를 씁니다. 서버가 재시작되면 계정이 초기화됩니다.');
    return SqliteStore.open(env.DB_PATH ?? defaultDbPath);
  }
  if (kind !== 'sqlite') throw new Error(`알 수 없는 STORE 값: ${env.STORE} (sqlite 또는 firestore)`);
  return SqliteStore.open(env.DB_PATH ?? defaultDbPath);
}
