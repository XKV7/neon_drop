import type { Cosmetic, Loadout } from '../data/cosmetics';
import type { HeroId } from '../data/types';

export interface HeroRecord { games: number; wins: number; kills: number }
export interface Profile {
  name: string; credits: number; owned: string[]; loadout: Loadout;
  stats: { games: number; wins: number; kills: number; bestKills: number; heroes: Partial<Record<HeroId, HeroRecord>>; xp?: number };
}

/** 서버 운영 설정 (클라이언트 표시용) */
export interface ServerInfo { maxMatches: number; privateMinLevel: number | null }

export interface RosterEntry { id: number; name: string; heroId: HeroId; cos: Cosmetic; isBot: boolean; title: number }

export interface ResultRow { id: number; pid: string; name: string; heroId: HeroId; isBot: boolean; placement: number; kills: number; damage: number; survival: number; augments: string[]; level: number }

export type ClientMsg =
  | { type: 'hello'; token?: string; name?: string; version: number }
  | { type: 'setName'; name: string }
  | { type: 'queue' } | { type: 'leaveQueue' }
  | { type: 'createRoom' } | { type: 'joinRoom'; code: string } | { type: 'leaveRoom' }
  | { type: 'roomSettings'; botFill: boolean; botLevel: number } | { type: 'startRoom' }
  | { type: 'pickHero'; heroId: HeroId } | { type: 'lockHero' }
  | { type: 'pickAug'; idx: number }
  | { type: 'spectate'; target: number }
  | { type: 'chat'; text: string } | { type: 'quick'; idx: number } | { type: 'emote'; idx: number }
  | { type: 'buy'; item: string } | { type: 'equip'; kind: 'palette' | 'skin' | 'kill' | 'drop' | 'title' | 'emote'; hero?: HeroId; idx: number; slot?: number }
  | { type: 'rematch' } | { type: 'leaveMatch' };

export type ServerMsg =
  | { type: 'welcome'; token: string; profile: Profile; server: ServerInfo }
  | { type: 'profile'; profile: Profile }
  | { type: 'error'; text: string }
  | { type: 'toast'; text: string }
  /** position: 내 대기 순번(1부터), full: 동시 진행 판이 가득 차 자리가 날 때까지 대기 중, active/max: 진행 중 판 수 */
  | { type: 'queueStatus'; count: number; timeLeft: number; position: number; full: boolean; active: number; max: number }
  | { type: 'room'; code: string; host: string; you: string; players: { pid: string; name: string }[]; botFill: boolean; botLevel: number }
  | { type: 'roomClosed' }
  /** 대기열 관전이 끝남 (관전하던 판이 끝났거나 내 차례가 옴) */
  | { type: 'spectateEnd' }
  | { type: 'heroSelect'; timeLeft: number; you: string; players: { pid: string; name: string; heroId: HeroId | null; locked: boolean; isBot: boolean }[]; loadout: Loadout }
  /** spectator: 대기 중 관전으로 들어온 경우 (you = 0) */
  | { type: 'matchStart'; matchId: string; seed: number; you: number; roster: RosterEntry[]; mode: 'br' | 'practice' | 'demo'; reconnect: boolean; spectator?: boolean }
  | { type: 'results'; rows: ResultRow[]; you: number; credits: number; total: number; rematch: string; xpGained?: number }
  | { type: 'rematchStatus'; count: number; total: number; timeLeft: number }
  | { type: 'chat'; from: string; text: string; heroId?: string; quick?: boolean }
  | { type: 'scoreboard'; rows: { id: number; name: string; heroId: HeroId; level: number; kills: number; alive: boolean; augments: string[]; placement: number; title: number; bot: boolean }[] };
