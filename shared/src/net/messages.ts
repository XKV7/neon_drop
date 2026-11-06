import type { Cosmetic, Loadout } from '../data/cosmetics';
import type { HeroId } from '../data/types';

export interface HeroRecord { games: number; wins: number; kills: number }
export interface Profile {
  name: string; credits: number; owned: string[]; loadout: Loadout;
  stats: { games: number; wins: number; kills: number; bestKills: number; heroes: Partial<Record<HeroId, HeroRecord>> };
}

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
  | { type: 'welcome'; token: string; profile: Profile }
  | { type: 'profile'; profile: Profile }
  | { type: 'error'; text: string }
  | { type: 'toast'; text: string }
  | { type: 'queueStatus'; count: number; timeLeft: number }
  | { type: 'room'; code: string; host: string; you: string; players: { pid: string; name: string }[]; botFill: boolean; botLevel: number }
  | { type: 'roomClosed' }
  | { type: 'heroSelect'; timeLeft: number; you: string; players: { pid: string; name: string; heroId: HeroId | null; locked: boolean; isBot: boolean }[]; loadout: Loadout }
  | { type: 'matchStart'; matchId: string; seed: number; you: number; roster: RosterEntry[]; mode: 'br' | 'practice' | 'demo'; reconnect: boolean }
  | { type: 'results'; rows: ResultRow[]; you: number; credits: number; total: number; rematch: string }
  | { type: 'rematchStatus'; count: number; total: number; timeLeft: number }
  | { type: 'chat'; from: string; text: string; heroId?: string; quick?: boolean }
  | { type: 'scoreboard'; rows: { id: number; name: string; heroId: HeroId; level: number; kills: number; alive: boolean; augments: string[]; placement: number; title: number; bot: boolean }[] };
