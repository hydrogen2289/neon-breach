// game.js — the match state machine: rounds, score, money, buy phase, win/lose.
// Pure logic: no DOM, no three.js. The UI reads state and calls the actions.
import { WEAPONS, WEAPON_ORDER } from './weapons.js';

export const ROUND_TIME = 100;
export const WINS_NEEDED = 5;
export const KILL_REWARD = 300;
export const WIN_REWARD = 400;
export const LOSS_REWARD = 200;
export const DRAW_REWARD = 250;
export const START_CREDITS = 800;

export class Match {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.phase = 'title'; // title | buy | playing | roundEnd | matchEnd
    this.round = 1;
    this.scoreYou = 0;
    this.scoreFoe = 0;
    this.credits = START_CREDITS;
    this.kills = 0;
    this.deaths = 0;
    this.timer = ROUND_TIME;
    this.owned = ['pistol'];
    this.weaponId = 'pistol';
    this.lastRoundWinner = null;
    this.lastRoundDetail = '';
    this.matchWon = false;
    this.roundsPlayed = 0;
  }

  startMatch() {
    this.round = 1;
    this.scoreYou = 0;
    this.scoreFoe = 0;
    this.credits = START_CREDITS;
    this.kills = 0;
    this.deaths = 0;
    this.owned = ['pistol'];
    this.weaponId = 'pistol';
    this.matchWon = false;
    this.roundsPlayed = 0;
    this.phase = 'buy';
    if (this.hooks.onPhase) this.hooks.onPhase('buy');
  }

  beginRound() {
    this.timer = ROUND_TIME;
    this.phase = 'playing';
    this.roundsPlayed += 1;
    if (this.hooks.onPhase) this.hooks.onPhase('playing');
  }

  // Called every frame while playing. Returns nothing; ends the round via hooks.
  update(dt, aliveYou, aliveFoe) {
    if (this.phase !== 'playing') return;
    this.timer -= dt;
    if (aliveFoe === 0) { this.endRound('you', 'Enemy team eliminated.'); return; }
    if (aliveYou === 0) { this.endRound('foe', 'Your squad was eliminated.'); return; }
    if (this.timer <= 0) {
      this.timer = 0;
      if (aliveYou > aliveFoe) this.endRound('you', `Time up — your squad holds ${aliveYou} alive against ${aliveFoe}.`);
      else if (aliveFoe > aliveYou) this.endRound('foe', `Time up — the enemy holds ${aliveFoe} alive against ${aliveYou}.`);
      else this.endRound('draw', 'Time up — both squads stand even. No point awarded.');
    }
  }

  endRound(winner, detail) {
    this.lastRoundWinner = winner;
    this.lastRoundDetail = detail;
    let reward = DRAW_REWARD;
    if (winner === 'you') { this.scoreYou += 1; reward = WIN_REWARD; }
    else if (winner === 'foe') { this.scoreFoe += 1; reward = LOSS_REWARD; }
    this.credits += reward;
    this.phase = 'roundEnd';
    if (this.hooks.onRoundEnd) this.hooks.onRoundEnd(winner, detail, reward);
    if (this.scoreYou >= WINS_NEEDED || this.scoreFoe >= WINS_NEEDED) {
      this.matchWon = this.scoreYou >= WINS_NEEDED;
      this.phase = 'matchEnd';
      if (this.hooks.onMatchEnd) this.hooks.onMatchEnd(this.matchWon);
    }
  }

  nextRound() {
    this.round += 1;
    this.phase = 'buy';
    if (this.hooks.onPhase) this.hooks.onPhase('buy');
  }

  noteKill() {
    this.kills += 1;
    this.credits += KILL_REWARD;
    if (this.hooks.onKillReward) this.hooks.onKillReward(this.kills, this.credits);
  }

  noteDeath() {
    this.deaths += 1;
  }

  // Buy a weapon for the player. Returns { ok, reason }.
  buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def) return { ok: false, reason: 'Unknown weapon.' };
    if (this.owned.includes(id)) {
      this.weaponId = id;
      return { ok: true, reason: `${def.name} equipped.` };
    }
    if (this.credits < def.price) return { ok: false, reason: `Need ${def.price} credits.` };
    this.credits -= def.price;
    this.owned.push(id);
    this.weaponId = id;
    return { ok: true, reason: `${def.name} purchased.` };
  }

  buyOptions() {
    return WEAPON_ORDER.map((id) => {
      const def = WEAPONS[id];
      return {
        id,
        name: def.name,
        price: def.price,
        owned: this.owned.includes(id),
        equipped: this.weaponId === id,
        affordable: this.credits >= def.price,
        stats: `DMG ${def.damage} · ${def.rpm} RPM · MAG ${def.mag}`,
      };
    });
  }
}
