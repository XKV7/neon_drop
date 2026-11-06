import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_LOADOUT, STARTING_CREDITS, type Loadout, type Profile, type HeroId } from '@neon/shared';

export interface Account { token: string; name: string; credits: number; owned: string[]; loadout: Loadout; stats: Profile['stats'] }

/** 게스트 계정 저장소 (SQLite) */
export class Store {
  db: Database.Database;
  private getStmt: Database.Statement;
  private insStmt: Database.Statement;
  private updStmt: Database.Statement;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS accounts (
      token TEXT PRIMARY KEY, name TEXT NOT NULL, credits INTEGER NOT NULL, owned TEXT NOT NULL, loadout TEXT NOT NULL, stats TEXT NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, created INTEGER NOT NULL, winner TEXT, players INTEGER, length REAL)`);
    this.getStmt = this.db.prepare('SELECT * FROM accounts WHERE token = ?');
    this.insStmt = this.db.prepare('INSERT INTO accounts (token, name, credits, owned, loadout, stats, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    this.updStmt = this.db.prepare('UPDATE accounts SET name = ?, credits = ?, owned = ?, loadout = ?, stats = ?, updated = ? WHERE token = ?');
  }

  get(token: string): Account | null {
    if (!/^[a-f0-9]{48}$/.test(token)) return null;
    const row = this.getStmt.get(token) as { token: string; name: string; credits: number; owned: string; loadout: string; stats: string } | undefined;
    if (!row) return null;
    return { token: row.token, name: row.name, credits: row.credits, owned: JSON.parse(row.owned), loadout: { ...DEFAULT_LOADOUT, ...JSON.parse(row.loadout) }, stats: JSON.parse(row.stats) };
  }

  create(name: string): Account {
    const acc: Account = {
      token: randomBytes(24).toString('hex'), name, credits: STARTING_CREDITS, owned: [], loadout: structuredClone(DEFAULT_LOADOUT),
      stats: { games: 0, wins: 0, kills: 0, bestKills: 0, heroes: {} },
    };
    const now = Date.now();
    this.insStmt.run(acc.token, acc.name, acc.credits, JSON.stringify(acc.owned), JSON.stringify(acc.loadout), JSON.stringify(acc.stats), now, now);
    return acc;
  }

  save(a: Account) {
    this.updStmt.run(a.name, a.credits, JSON.stringify(a.owned), JSON.stringify(a.loadout), JSON.stringify(a.stats), Date.now(), a.token);
  }

  recordMatch(id: string, winner: string, players: number, length: number) {
    this.db.prepare('INSERT OR REPLACE INTO matches (id, created, winner, players, length) VALUES (?, ?, ?, ?, ?)').run(id, Date.now(), winner, players, length);
  }

  addResult(a: Account, heroId: HeroId, placement: number, kills: number, credits: number) {
    a.credits += credits;
    a.stats.games++;
    if (placement === 1) a.stats.wins++;
    a.stats.kills += kills;
    a.stats.bestKills = Math.max(a.stats.bestKills, kills);
    const hr = a.stats.heroes[heroId] ?? { games: 0, wins: 0, kills: 0 };
    hr.games++; if (placement === 1) hr.wins++; hr.kills += kills;
    a.stats.heroes[heroId] = hr;
    this.save(a);
  }
}

export function toProfile(a: Account): Profile {
  return { name: a.name, credits: a.credits, owned: a.owned, loadout: a.loadout, stats: a.stats };
}
