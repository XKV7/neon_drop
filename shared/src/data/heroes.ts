import type { HeroDef, HeroId } from './types';

/**
 * 영웅 데이터. 모든 수치(체력, 속도, 쿨타임, 피해, 범위)를 여기서 조정한다.
 * cd/cast/dur 단위는 초, 거리 단위는 m.
 */
export const HEROES: HeroDef[] = [
  {
    id: 'hammerdog', index: 0, name: '해머독', title: '유압 주먹 전직 경비원', role: 'bruiser', difficulty: 1,
    hp: 1950, speed: 5.4, ultReq: 1125, size: 1.15, color: 0xffb020, color2: 0x22f3ff, style: 'heavy',
    lore: '메가코프 보안팀에서 해고당한 날, 그는 유압 주먹만은 반납하지 않았다.',
    lines: ['근무 시간이다.', '출입 금지 구역이야.', '한 방이면 충분해.'],
    basic: {
      id: 'hd_basic', name: '유압 잽', desc: '전방을 강하게 후려친다.', cd: 0.7, cast: 0.12, castMove: 0.6, target: 'dir', range: 2.4,
      indicator: { shape: 'cone', angle: 100 }, anim: 'punch', ai: { use: 'damage', range: 2.4 },
      actions: [{ t: 'melee', range: 2.5, angle: 100, dmg: 54 }],
    },
    skills: [
      {
        id: 'hd_s1', name: '충격 펀치', desc: '충격파를 날려 맞은 적을 밀쳐낸다.', cd: 6, cast: 0.2, castMove: 0.3, target: 'dir', range: 7.5,
        indicator: { shape: 'line', width: 1.8 }, anim: 'punch', ai: { use: 'cc', range: 7 },
        actions: [{ t: 'projectile', speed: 22, range: 7.5, radius: 0.9, dmg: 95, pierce: 5, onHit: [{ t: 'knock', dist: 3.2, from: 'caster' }], visual: 'shock' }],
      },
      {
        id: 'hd_s2', name: '지면 강타', desc: '주변 지면을 내려쳐 피해를 주고 둔화시킨다.', cd: 8, cast: 0.35, castMove: 0, target: 'self', range: 3.6,
        indicator: { shape: 'self', radius: 3.6 }, anim: 'slam', ai: { use: 'damage', range: 3.2 },
        actions: [{ t: 'aoe', at: 'self', radius: 3.6, delay: 0, dmg: 120, onHit: [{ t: 'slow', pct: 0.4, dur: 1.5 }], visual: 'slam' }],
      },
      {
        id: 'hd_s3', name: '유압 돌진', desc: '전방으로 돌진해 처음 맞은 적을 붙잡아 내리꽂고 기절시킨다.', cd: 9, cast: 0.05, target: 'dir', range: 8,
        indicator: { shape: 'line', width: 1.6 }, anim: 'dash', ai: { use: 'engage', range: 8 },
        actions: [{ t: 'dash', dist: 8, speed: 24, hitRadius: 1.0, dmg: 75, stopOnHit: true, onHit: [{ t: 'stun', dur: 0.6 }] }],
      },
    ],
    ult: {
      id: 'hd_ult', name: '낙하 해머', desc: '반경 7m 안의 적을 모두 끌어당긴 뒤 내려찍어 큰 피해를 주고 기절시킨다.', cd: 1, cast: 0.25, castMove: 0, target: 'self', range: 7,
      indicator: { shape: 'self', radius: 7 }, anim: 'slam', ai: { use: 'engage', range: 6.5 },
      actions: [
        { t: 'pullAll', radius: 7, to: 1.6 },
        { t: 'aoe', at: 'self', radius: 3.4, delay: 0.4, dmg: 200, onHit: [{ t: 'stun', dur: 1.0 }], visual: 'hammer' },
      ],
    },
  },
  {
    id: 'redline', index: 1, name: '레드라인', title: '체인소 칼날 폭주족', role: 'bruiser', difficulty: 2,
    hp: 2080, speed: 5.65, ultReq: 1200, size: 1.05, color: 0xff3355, color2: 0xffe14d, style: 'biker',
    lore: '신서울 고속도로의 마지막 폭주족. 엔진 소리는 그의 심장 소리다.',
    lines: ['풀 스로틀!', '브레이크는 없어.', '갈아버린다!'],
    basic: {
      id: 'rl_basic', name: '체인소 베기', desc: '넓은 범위를 톱날로 벤다.', cd: 0.55, cast: 0.1, castMove: 0.7, target: 'dir', range: 2.6,
      indicator: { shape: 'cone', angle: 120 }, anim: 'slash', ai: { use: 'damage', range: 2.6 },
      actions: [{ t: 'melee', range: 2.7, angle: 120, dmg: 53 }],
    },
    skills: [
      {
        id: 'rl_s1', name: '회전 베기', desc: '2.5초간 회전하며 주변 적에게 지속 피해를 준다.', cd: 9, cast: 0, target: 'self', range: 2.9,
        indicator: { shape: 'self', radius: 2.9 }, anim: 'spin', ai: { use: 'damage', range: 2.6 },
        actions: [
          { t: 'zone', at: 'self', follow: true, radius: 2.9, duration: 2.5, interval: 0.25, dmg: 27, visual: 'spin' },
          { t: 'buff', haste: { pct: 0.12, dur: 2.5 } },
        ],
      },
      {
        id: 'rl_s2', name: '체인 블레이드', desc: '톱날을 던져 관통하는 모든 적에게 피해를 주고 둔화시킨다.', cd: 7, cast: 0.15, castMove: 0.5, target: 'dir', range: 9,
        indicator: { shape: 'line', width: 1.4 }, anim: 'throw', ai: { use: 'damage', range: 8.5 },
        actions: [{ t: 'projectile', speed: 19, range: 9, radius: 0.7, dmg: 100, pierce: 9, onHit: [{ t: 'slow', pct: 0.3, dur: 1.2 }], visual: 'blade' }],
      },
      {
        id: 'rl_s3', name: '번아웃', desc: '엔진을 폭발시켜 전방으로 질주하며 경로의 적에게 피해를 준다.', cd: 8, cast: 0, target: 'dir', range: 8,
        indicator: { shape: 'line', width: 2.2 }, anim: 'dash', ai: { use: 'mobility', range: 8 },
        actions: [{ t: 'dash', dist: 8, speed: 22, hitRadius: 1.1, dmg: 70 }],
      },
    ],
    ult: {
      id: 'rl_ult', name: '풀 스로틀', desc: '18m를 무적 상태로 질주하며 경로 전체의 적을 베고 옆으로 튕겨낸다.', cd: 1, cast: 0.3, castMove: 0, target: 'dir', range: 18,
      indicator: { shape: 'line', width: 3.2 }, anim: 'dash', ai: { use: 'engage', range: 16 },
      actions: [{ t: 'dash', dist: 18, speed: 30, hitRadius: 1.6, dmg: 270, untargetable: true, onHit: [{ t: 'knock', dist: 2.2, from: 'side' }, { t: 'slow', pct: 0.35, dur: 1.5 }] }],
    },
  },
  {
    id: 'mirage', index: 2, name: '미라주', title: '광학 위장 닌자', role: 'assassin', difficulty: 3,
    hp: 1380, speed: 6.0, ultReq: 1050, size: 0.95, color: 0x22f3ff, color2: 0xff2bd6, style: 'ninja',
    lore: '빛을 휘게 만드는 슈트. 그녀를 본 자는 이미 쓰러진 뒤다.',
    lines: ['보이지 않을 거야.', '이미 늦었어.', '그림자는 배신하지 않아.'],
    basic: {
      id: 'mr_basic', name: '쌍검 베기', desc: '빠르게 두 번 벤다.', cd: 0.45, cast: 0.08, castMove: 0.8, target: 'dir', range: 2.3,
      indicator: { shape: 'cone', angle: 90 }, anim: 'slash', ai: { use: 'damage', range: 2.3 },
      actions: [{ t: 'melee', range: 2.4, angle: 90, dmg: 40 }],
    },
    skills: [
      {
        id: 'mr_s1', name: '수리검', desc: '빠른 수리검을 던져 피해를 주고 4초간 표식을 남긴다. 표식 대상은 궁극기 우선 대상.', cd: 5, cast: 0.1, castMove: 0.7, target: 'dir', range: 10.5,
        indicator: { shape: 'line', width: 0.9 }, anim: 'throw', ai: { use: 'damage', range: 10 },
        actions: [{ t: 'projectile', speed: 27, range: 10.5, radius: 0.45, dmg: 82, onHit: [{ t: 'mark', dur: 4 }], visual: 'shuriken' }],
      },
      {
        id: 'mr_s2', name: '광학 위장', desc: '3.5초간 은신하고 이동 속도가 증가한다. 은신 중 첫 공격은 피해 60% 증가.', cd: 14, cast: 0, target: 'self', range: 0,
        indicator: { shape: 'self', radius: 1.2 }, anim: 'cast', ai: { use: 'buff', range: 9 },
        actions: [{ t: 'buff', stealth: 3.5, haste: { pct: 0.25, dur: 3.5 }, ambush: 0.6 }],
      },
      {
        id: 'mr_s3', name: '섬광 베기', desc: '조준 방향으로 순간이동하며 경로의 적을 벤다.', cd: 7, cast: 0.05, target: 'dir', range: 6.5,
        indicator: { shape: 'line', width: 1.4 }, anim: 'dash', ai: { use: 'mobility', range: 6.5 },
        actions: [{ t: 'blink', dist: 6.5, trail: { width: 1.4, dmg: 58 } }],
      },
    ],
    ult: {
      id: 'mr_ult', name: '천 개의 잔상', desc: '조준 지점 근처의 적(표식 대상 우선)에게 무적 상태로 연속 점멸 공격 5회.', cd: 1, cast: 0.1, target: 'point', range: 9,
      indicator: { shape: 'circle', radius: 2.5 }, needsTarget: true, anim: 'dash', ai: { use: 'engage', range: 9 },
      actions: [{ t: 'strikes', range: 9, count: 5, interval: 0.22, dmg: 50 }],
    },
  },
  {
    id: 'silk', index: 3, name: '실크', title: '나노와이어 거미', role: 'assassin', difficulty: 3,
    hp: 1760, speed: 5.9, ultReq: 1125, size: 1.0, color: 0x9b5cff, color2: 0x4dff88, style: 'spider',
    lore: '등에 달린 여섯 개의 나노와이어 발. 도시 전체가 그녀의 거미줄이다.',
    lines: ['걸려들었네.', '도망칠 곳은 없어.', '줄은 이미 쳐놨어.'],
    basic: {
      id: 'sk_basic', name: '와이어 휘두르기', desc: '긴 사거리로 와이어를 휘두른다.', cd: 0.6, cast: 0.1, castMove: 0.7, target: 'dir', range: 4.3,
      indicator: { shape: 'cone', angle: 24 }, anim: 'slash', ai: { use: 'damage', range: 4.1 },
      actions: [{ t: 'melee', range: 4.4, angle: 24, dmg: 51 }],
    },
    skills: [
      {
        id: 'sk_s1', name: '나노 덫', desc: '지정 위치에 보이지 않는 덫을 설치한다. 밟은 적은 속박되고 피해를 입는다. (최대 3개)', cd: 5, cast: 0.15, castMove: 0.5, target: 'point', range: 7.5,
        indicator: { shape: 'circle', radius: 1.2 }, anim: 'cast', ai: { use: 'zone', range: 7 },
        actions: [{ t: 'deploy', kind: 'trap', duration: 25, max: 3, range: 1.2, arm: 0.6, dmg: 100, onHit: [{ t: 'root', dur: 1.4 }, { t: 'reveal', dur: 3 }], visual: 'trap' }],
      },
      {
        id: 'sk_s2', name: '와이어 채찍', desc: '와이어를 날려 맞은 적을 끌어당기고 둔화시킨다.', cd: 7, cast: 0.15, castMove: 0.4, target: 'dir', range: 9.5,
        indicator: { shape: 'line', width: 1.0 }, anim: 'throw', ai: { use: 'cc', range: 9 },
        actions: [{ t: 'projectile', speed: 25, range: 9.5, radius: 0.5, dmg: 74, onHit: [{ t: 'pull', dist: 3.5 }, { t: 'slow', pct: 0.35, dur: 1.2 }], visual: 'wire' }],
      },
      {
        id: 'sk_s3', name: '와이어 스윙', desc: '와이어를 쏴서 벽에 맞으면 벽까지 빠르게 당겨 붙는다 (최대 12m). 벽에 붙으면 다음 기본 공격 강화.', cd: 7, cast: 0, target: 'dir', range: 12,
        indicator: { shape: 'line', width: 0.6 }, anim: 'leap', ai: { use: 'mobility', range: 12 },
        actions: [{ t: 'dash', dist: 5, speed: 27, wire: { range: 12, shortDist: 5, clingBonus: 0.5 }, haste: { pct: 0.2, dur: 1.5 } }],
      },
    ],
    ult: {
      id: 'sk_ult', name: '거미줄 영역', desc: '넓은 구역에 와이어 그물을 친다. 안의 적은 1초 속박되고, 4초간 크게 둔화되며 지속 피해를 입는다.', cd: 1, cast: 0.2, castMove: 0.3, target: 'point', range: 11,
      indicator: { shape: 'circle', radius: 8.5 }, anim: 'cast', ai: { use: 'engage', range: 11 },
      actions: [{ t: 'zone', at: 'point', radius: 8.5, duration: 4, interval: 0.5, dmg: 22, delay: 0.6, startEffects: [{ t: 'root', dur: 1.0 }], onTick: [{ t: 'slow', pct: 0.5, dur: 0.6 }], visual: 'web' }],
    },
  },
  {
    id: 'rail', index: 4, name: '레일', title: '레일건 저격수', role: 'ranged', difficulty: 2,
    hp: 1760, speed: 5.5, ultReq: 1200, size: 1.0, color: 0x3d7bff, color2: 0xffffff, style: 'sniper',
    lore: '구역 끝에서 끝까지. 그녀의 탄환은 도시의 소음보다 빠르다.',
    lines: ['조준 완료.', '거리는 문제가 아니야.', '한 발이면 끝.'],
    basic: {
      id: 'ra_basic', name: '자동 소총', desc: '빠른 탄환을 발사한다.', cd: 0.62, cast: 0.08, castMove: 0.75, target: 'dir', range: 12,
      indicator: { shape: 'line', width: 0.5 }, anim: 'shoot', ai: { use: 'damage', range: 11.5 },
      actions: [{ t: 'projectile', speed: 32, range: 12, radius: 0.4, dmg: 62, visual: 'bullet' }],
    },
    skills: [
      {
        id: 'ra_s1', name: '차지 사격', desc: '누르고 있으면 충전되며, 놓으면 관통탄을 발사한다. 충전할수록 피해와 사거리 증가.', cd: 6, cast: 0, target: 'dir', range: 20,
        indicator: { shape: 'line', width: 1.0 }, chargeUp: { max: 1.4, move: 0.55 }, anim: 'charge', ai: { use: 'damage', range: 16 },
        actions: [{ t: 'projectile', speed: 46, range: 20, radius: 0.5, dmg: 70, pierce: 3, chargeScale: { dmg: [100, 300], range: [10, 20] }, visual: 'rail' }],
      },
      {
        id: 'ra_s2', name: 'EMP 수류탄', desc: '지정 위치에 EMP를 던져 0.7초 후 폭발, 피해와 큰 둔화를 준다.', cd: 9, cast: 0.15, castMove: 0.5, target: 'point', range: 9,
        indicator: { shape: 'circle', radius: 2.8 }, anim: 'throw', ai: { use: 'cc', range: 9 },
        actions: [{ t: 'aoe', at: 'point', radius: 2.8, delay: 0.7, dmg: 95, onHit: [{ t: 'slow', pct: 0.5, dur: 1.6 }], visual: 'emp' }],
      },
      {
        id: 'ra_s3', name: '후퇴 점프', desc: '조준 반대 방향으로 높이 뛰어 물러난다. 착지 후 다음 기본 공격 강화.', cd: 8, cast: 0, target: 'dir', range: 6.5,
        indicator: { shape: 'line', width: 1.0 }, anim: 'leap', ai: { use: 'mobility', range: 6.5 },
        actions: [{ t: 'dash', dist: 6.5, speed: 19, backward: true, airborne: true, empower: 0.5 }],
      },
    ],
    ult: {
      id: 'ra_ult', name: '궤도 레이저', desc: '1초 조준 후 맵 절반(40m)을 관통하는 레이저를 발사한다.', cd: 1, cast: 0.1, castMove: 0, target: 'dir', range: 40,
      indicator: { shape: 'line', width: 2.4 }, anim: 'charge', ai: { use: 'damage', range: 30 },
      actions: [{ t: 'beam', length: 40, width: 2.4, delay: 1.0, dmg: 380 }],
    },
  },
  {
    id: 'hive', index: 5, name: '하이브', title: '드론 조종사', role: 'ranged', difficulty: 2,
    hp: 1720, speed: 5.6, ultReq: 1200, size: 1.0, color: 0x4dff88, color2: 0xff7a1a, style: 'pilot',
    lore: '창고 하나 분량의 해킹 드론. 그는 혼자가 아니다.',
    lines: ['편대, 전개.', '하늘을 봐.', '좌표 전송 완료.'],
    basic: {
      id: 'hv_basic', name: '펄스 권총', desc: '연사형 에너지탄.', cd: 0.48, cast: 0.06, castMove: 0.8, target: 'dir', range: 10.5,
      indicator: { shape: 'line', width: 0.5 }, anim: 'shoot', ai: { use: 'damage', range: 10 },
      actions: [{ t: 'projectile', speed: 25, range: 10.5, radius: 0.45, dmg: 47, visual: 'bolt' }],
    },
    skills: [
      {
        id: 'hv_s1', name: '마이크로 미사일', desc: '부채꼴로 미사일 3발을 발사해 착탄 지점에서 폭발한다.', cd: 6, cast: 0.15, castMove: 0.5, target: 'dir', range: 10,
        indicator: { shape: 'cone', angle: 40 }, anim: 'shoot', ai: { use: 'damage', range: 9.5 },
        actions: [{ t: 'projectile', speed: 18, range: 10, radius: 0.45, dmg: 0, count: 3, spread: 22, explode: { radius: 1.8, dmg: 86 }, visual: 'missile' }],
      },
      {
        id: 'hv_s2', name: '전투 드론', desc: '지정 위치에 9초간 적을 자동 사격하는 드론을 배치한다. (최대 2대)', cd: 10, cast: 0.2, castMove: 0.5, target: 'point', range: 7,
        indicator: { shape: 'circle', radius: 7 }, anim: 'cast', ai: { use: 'zone', range: 7 },
        actions: [{ t: 'deploy', kind: 'turret', duration: 9, max: 2, range: 7, interval: 0.6, dmg: 32, projSpeed: 22, visual: 'turret' }],
      },
      {
        id: 'hv_s3', name: '부스터 팩', desc: '조준 방향으로 날아오르며 잠시 이동 속도가 증가한다.', cd: 8, cast: 0, target: 'dir', range: 7,
        indicator: { shape: 'line', width: 1.0 }, anim: 'leap', ai: { use: 'mobility', range: 7 },
        actions: [{ t: 'dash', dist: 7, speed: 21, haste: { pct: 0.3, dur: 1.5 } }],
      },
    ],
    ult: {
      id: 'hv_ult', name: '편대 폭격', desc: '지정 구역에 드론 편대가 연속 폭탄을 투하한다.', cd: 1, cast: 0.2, castMove: 0.3, target: 'point', range: 14,
      indicator: { shape: 'circle', radius: 5.5 }, anim: 'cast', ai: { use: 'damage', range: 14 },
      actions: [{ t: 'bombard', radius: 5.5, count: 9, interval: 0.2, delay: 0.7, bombRadius: 2.1, dmg: 95 }],
    },
  },
  {
    id: 'glitch', index: 6, name: '글리치', title: '해커', role: 'control', difficulty: 3,
    hp: 1720, speed: 5.75, ultReq: 1125, size: 0.95, color: 0xff2bd6, color2: 0x22f3ff, style: 'hacker',
    lore: '드롭의 방송 서버에 백도어를 심은 장본인. 이번엔 직접 참가했다.',
    lines: ['접근 권한 획득.', '네 코드, 다 보여.', '재부팅해 줄게.'],
    basic: {
      id: 'gl_basic', name: '데이터 볼트', desc: '데이터 탄을 발사한다.', cd: 0.55, cast: 0.07, castMove: 0.75, target: 'dir', range: 10,
      indicator: { shape: 'line', width: 0.5 }, anim: 'shoot', ai: { use: 'damage', range: 9.5 },
      actions: [{ t: 'projectile', speed: 23, range: 10, radius: 0.45, dmg: 53, visual: 'code' }],
    },
    skills: [
      {
        id: 'gl_s1', name: '봉인 코드', desc: '맞은 적의 스킬을 1.6초간 봉인하고 피해를 준다.', cd: 7.5, cast: 0.15, castMove: 0.5, target: 'dir', range: 11,
        indicator: { shape: 'line', width: 1.1 }, anim: 'cast', ai: { use: 'cc', range: 10.5 },
        actions: [{ t: 'projectile', speed: 21, range: 11, radius: 0.6, dmg: 95, onHit: [{ t: 'silence', dur: 1.6 }], visual: 'code' }],
      },
      {
        id: 'gl_s2', name: '해킹 장판', desc: '지정 위치에 5초간 해킹 장판을 깔고, 해킹된 포탑이 장판 안의 적을 사격한다.', cd: 11, cast: 0.2, castMove: 0.5, target: 'point', range: 8,
        indicator: { shape: 'circle', radius: 4.2 }, anim: 'cast', ai: { use: 'zone', range: 8 },
        actions: [{ t: 'deploy', kind: 'turret', duration: 5, max: 1, range: 4.2, interval: 0.45, dmg: 32, projSpeed: 26, zone: true, onHit: [{ t: 'slow', pct: 0.15, dur: 0.5 }], visual: 'hack' }],
      },
      {
        id: 'gl_s3', name: '패킷 전송', desc: '지정 위치로 순간이동한다.', cd: 8, cast: 0.1, castMove: 0.5, target: 'point', range: 7.5,
        indicator: { shape: 'circle', radius: 0.8 }, anim: 'cast', ai: { use: 'mobility', range: 7.5 },
        actions: [{ t: 'blink', dist: 7.5 }],
      },
    ],
    ult: {
      id: 'gl_ult', name: '시스템 오버라이드', desc: '반경 8m 안 모든 적의 조작을 3초간 반전시키고 피해를 준다.', cd: 1, cast: 0.3, castMove: 0, target: 'self', range: 8,
      indicator: { shape: 'self', radius: 8 }, anim: 'cast', ai: { use: 'engage', range: 7.5 },
      actions: [{ t: 'areaAll', radius: 8, dmg: 155, onHit: [{ t: 'invert', dur: 3 }], visual: 'override' }],
    },
  },
  {
    id: 'horizon', index: 7, name: '호라이즌', title: '중력 연구원', role: 'control', difficulty: 2,
    hp: 1760, speed: 5.5, ultReq: 1200, size: 1.0, color: 0xb36bff, color2: 0xffe14d, style: 'scientist',
    lore: '실험실 사고로 중력을 다루게 된 연구원. 사고였는지는 아무도 모른다.',
    lines: ['중력에 굴복해.', '사건의 지평선 너머로.', '계산은 끝났어.'],
    basic: {
      id: 'hz_basic', name: '중력 구체', desc: '느린 중력 구체로 맞은 적을 살짝 둔화시킨다.', cd: 0.7, cast: 0.1, castMove: 0.7, target: 'dir', range: 10,
      indicator: { shape: 'line', width: 1.1 }, anim: 'cast', ai: { use: 'damage', range: 9.5 },
      actions: [{ t: 'projectile', speed: 17, range: 10, radius: 0.6, dmg: 60, onHit: [{ t: 'slow', pct: 0.15, dur: 0.6 }], visual: 'orb' }],
    },
    skills: [
      {
        id: 'hz_s1', name: '중력장', desc: '지정 위치에 3초간 중력장을 만들어 적을 둔화시키고 지속 피해를 준다.', cd: 8, cast: 0.15, castMove: 0.5, target: 'point', range: 9,
        indicator: { shape: 'circle', radius: 3.4 }, anim: 'cast', ai: { use: 'zone', range: 9 },
        actions: [{ t: 'zone', at: 'point', radius: 3.4, duration: 3, interval: 0.5, dmg: 28, onTick: [{ t: 'slow', pct: 0.4, dur: 0.6 }], visual: 'gravity' }],
      },
      {
        id: 'hz_s2', name: '척력파', desc: '전방 부채꼴의 적을 강하게 밀쳐낸다.', cd: 9, cast: 0.15, castMove: 0.3, target: 'dir', range: 5.5,
        indicator: { shape: 'cone', angle: 100 }, anim: 'cast', ai: { use: 'cc', range: 5 },
        actions: [{ t: 'aoe', at: 'self', radius: 5.5, delay: 0, cone: 100, dmg: 65, onHit: [{ t: 'knock', dist: 4.5, from: 'caster' }], visual: 'cone' }],
      },
      {
        id: 'hz_s3', name: '중력 도약', desc: '지정 위치로 도약해 착지 지점의 적에게 피해와 둔화를 준다.', cd: 9, cast: 0, target: 'point', range: 7.5,
        indicator: { shape: 'circle', radius: 2.2 }, anim: 'leap', ai: { use: 'mobility', range: 7.5 },
        actions: [{ t: 'dash', dist: 7.5, speed: 17, toPoint: true, airborne: true, endAoe: { radius: 2.2, dmg: 55, onHit: [{ t: 'slow', pct: 0.3, dur: 1 }] } }],
      },
    ],
    ult: {
      id: 'hz_ult', name: '특이점', desc: '지정 위치에 3초간 블랙홀을 생성해 적을 중심으로 끌어당기며 피해를 준다.', cd: 1, cast: 0.25, castMove: 0.2, target: 'point', range: 10.5,
      indicator: { shape: 'circle', radius: 6 }, anim: 'cast', ai: { use: 'engage', range: 10 },
      actions: [{ t: 'zone', at: 'point', radius: 6, duration: 3, interval: 0.2, dmg: 19, pull: 3.6, visual: 'blackhole' }],
    },
  },
];

export const HERO_BY_ID: Record<HeroId, HeroDef> = Object.fromEntries(HEROES.map(h => [h.id, h])) as Record<HeroId, HeroDef>;
export const HERO_IDS: HeroId[] = HEROES.map(h => h.id);
export const ROLE_NAMES: Record<string, string> = { bruiser: '브루저', assassin: '암살자', ranged: '원거리', control: '컨트롤' };

/** 레벨별 보정 */
export const LEVEL_HP_BONUS = 0.08; // 레벨당 최대 체력 +8%
export const LEVEL_DMG_BONUS = 0.05; // 레벨당 피해 +5%
export const XP_TABLE = [0, 120, 290, 500, 750, 1040, 1370, 1740]; // 레벨 1..8 누적 경험치
export const XP_REWARD = { kill: 140, killPerLevel: 30, drone: 80, core: 26 };
export const ULT_PASSIVE_PER_SEC = 0.006;
export const OOC_REGEN = { delay: 4, pctPerSec: 0.035 }; // 비전투 시 기본 재생 // 초당 궁극기 자연 충전
export const ULT_TAKEN_RATIO = 0.5; // 받은 피해의 충전 비율
