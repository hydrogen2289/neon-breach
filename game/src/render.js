// render.js — the HUD and the screens. DOM only; the game never touches these
// elements directly, it calls the methods here.
export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      round: $('hud-round'),
      scoreYou: $('hud-score-you'),
      scoreFoe: $('hud-score-foe'),
      timer: $('hud-timer'),
      alive: $('hud-alive'),
      credits: $('hud-credits-value'),
      killfeed: $('killfeed'),
      weapon: $('hud-weapon'),
      healthFill: $('hud-healthfill'),
      health: $('hud-health'),
      ammoMag: $('hud-ammo-mag'),
      ammoReserve: $('hud-ammo-reserve'),
      reload: $('hud-reload'),
      hitmarker: $('hitmarker'),
      vignette: $('vignette'),
      banner: $('banner'),
      hint: $('hint'),
      screens: {
        title: $('screen-title'),
        buy: $('screen-buy'),
        round: $('screen-round'),
        match: $('screen-match'),
        lock: $('screen-lock'),
      },
      buyRound: $('buy-round'),
      buyGrid: $('buy-grid'),
      buyCredits: $('buy-credits'),
      roundTitle: $('round-title'),
      roundScoreYou: $('round-score-you'),
      roundScoreFoe: $('round-score-foe'),
      roundDetail: $('round-detail'),
      matchTitle: $('match-title'),
      matchScoreYou: $('match-score-you'),
      matchScoreFoe: $('match-score-foe'),
      matchDetail: $('match-detail'),
    };
    this.el.banner.style.transition = 'opacity 0.4s';
    this.el.vignette.style.transition = 'opacity 0.12s';
    this.bannerTimer = 0;
    this.vignetteTimer = 0;
    this.last = {};
  }

  showHud(on) {
    this.el.hud.classList.toggle('on', on);
  }

  // Show one screen by name ('title' | 'buy' | 'round' | 'match' | 'lock') or none.
  showScreen(name) {
    for (const key of Object.keys(this.el.screens)) {
      this.el.screens[key].classList.toggle('on', key === name);
    }
  }

  set(key, value, el) {
    if (this.last[key] !== value) {
      this.last[key] = value;
      el.textContent = value;
    }
  }

  update(s) {
    this.set('round', String(s.round), this.el.round);
    this.set('scoreYou', String(s.scoreYou), this.el.scoreYou);
    this.set('scoreFoe', String(s.scoreFoe), this.el.scoreFoe);
    const t = Math.max(0, Math.ceil(s.timer));
    this.set('timer', String(t), this.el.timer);
    this.el.timer.classList.toggle('warn', t <= 30 && t > 10);
    this.el.timer.classList.toggle('low', t <= 10);
    this.set('alive', `${s.aliveYou} : ${s.aliveFoe}`, this.el.alive);
    this.set('credits', String(s.credits), this.el.credits);
    this.set('weapon', s.weaponName, this.el.weapon);
    const hpPct = Math.max(0, Math.min(100, (s.health / s.maxHealth) * 100));
    this.el.healthFill.style.width = `${hpPct}%`;
    this.el.healthFill.classList.toggle('low', hpPct <= 30);
    this.set('health', `HP ${Math.ceil(Math.max(0, s.health))}`, this.el.health);
    this.set('ammo', `${s.ammo} / ${s.reserve}`, this.el.ammoMag);
    this.el.ammoMag.textContent = String(s.ammo);
    this.el.ammoReserve.textContent = s.reserve === Infinity ? '∞' : String(s.reserve);
    this.el.reload.textContent = s.reloading ? 'RELOADING…' : '';
  }

  killfeedAdd(killer, killerColor, victim, victimColor) {
    const div = document.createElement('div');
    div.innerHTML = `<span style="color:${killerColor}">${killer}</span> ▸ <span style="color:${victimColor}">${victim}</span>`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => { if (div.parentNode) div.remove(); }, 5000);
  }

  hitmarker(kill) {
    const el = this.el.hitmarker;
    el.classList.toggle('kill', kill);
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 120);
  }

  damageFlash() {
    this.el.vignette.style.opacity = '1';
    clearTimeout(this.vignetteTimer);
    this.vignetteTimer = setTimeout(() => { this.el.vignette.style.opacity = '0'; }, 180);
  }

  banner(text, sub = '') {
    const el = this.el.banner;
    el.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
    el.style.opacity = '1';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }

  setHint(text) {
    this.el.hint.textContent = text;
  }

  renderBuy(options, credits, round, onBuy) {
    this.el.buyRound.textContent = String(round);
    this.el.buyCredits.textContent = `CREDITS ${credits}`;
    const grid = this.el.buyGrid;
    grid.innerHTML = '';
    options.forEach((opt, i) => {
      const card = document.createElement('div');
      card.className = 'buy-card' + (opt.equipped ? ' owned' : '') + (!opt.owned && !opt.affordable ? ' cant' : '');
      card.innerHTML = `<span class="key">${i + 1}</span><h3>${opt.name}</h3>` +
        `<div class="price">${opt.owned ? (opt.equipped ? 'EQUIPPED' : 'OWNED — click to equip') : `$${opt.price}`}</div>` +
        `<div class="stats">${opt.stats}</div>`;
      card.addEventListener('click', () => onBuy(opt.id));
      grid.appendChild(card);
    });
  }

  roundEnd(winner, scoreYou, scoreFoe, detail) {
    this.el.roundTitle.textContent = winner === 'you' ? 'ROUND WON' : winner === 'foe' ? 'ROUND LOST' : 'ROUND DRAW';
    this.el.roundTitle.style.color = winner === 'you' ? '#22e6ff' : winner === 'foe' ? '#ff2d95' : '#ffb020';
    this.el.roundScoreYou.textContent = String(scoreYou);
    this.el.roundScoreFoe.textContent = String(scoreFoe);
    this.el.roundDetail.textContent = detail;
    this.showScreen('round');
  }

  matchEnd(won, scoreYou, scoreFoe, kills, deaths) {
    this.el.matchTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
    this.el.matchTitle.style.color = won ? '#22e6ff' : '#ff2d95';
    this.el.matchScoreYou.textContent = String(scoreYou);
    this.el.matchScoreFoe.textContent = String(scoreFoe);
    this.el.matchDetail.textContent = won
      ? `You breached the arena and took the match. ${kills} eliminations, ${deaths} ${deaths === 1 ? 'death' : 'deaths'}.`
      : `The enemy held the arena. ${kills} eliminations, ${deaths} ${deaths === 1 ? 'death' : 'deaths'}. Run it back.`;
    this.showScreen('match');
  }
}
