// weapons.js — weapon definitions and hitscan fire. Damage falls off with range;
// spread grows while moving and shrinks while standing still.
import * as THREE from 'three';

// id, display name, price, damage per bullet, rounds per minute, magazine, reload seconds,
// spread in radians at rest, pellets per shot, tracer colour, sound kind.
export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P-9 SPARK', price: 0, damage: 26, rpm: 320, mag: 12, reload: 1.1, spread: 0.012, pellets: 1, tracer: 0x7df9ff, sound: 'pistol', auto: false },
  smg: { id: 'smg', name: 'VX-9 RIPPER', price: 1200, damage: 17, rpm: 820, mag: 30, reload: 1.5, spread: 0.03, pellets: 1, tracer: 0x22e6ff, sound: 'smg', auto: true },
  rifle: { id: 'rifle', name: 'AR-77 NEON', price: 2500, damage: 32, rpm: 600, mag: 25, reload: 1.7, spread: 0.016, pellets: 1, tracer: 0xffd23f, sound: 'rifle', auto: true },
  shotgun: { id: 'shotgun', name: 'SG-12 PULSE', price: 1800, damage: 13, rpm: 85, mag: 6, reload: 2.2, spread: 0.055, pellets: 6, tracer: 0xff9d00, sound: 'shotgun', auto: false },
  sniper: { id: 'sniper', name: 'LS-50 GHOST', price: 4000, damage: 95, rpm: 55, mag: 5, reload: 2.4, spread: 0.003, pellets: 1, tracer: 0xff2d95, sound: 'sniper', auto: false },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper'];

// A live weapon instance: ammo state, cooldowns, and one fire() that resolves a hitscan shot.
export class Weapon {
  constructor(defId) {
    this.def = WEAPONS[defId] || WEAPONS.pistol;
    this.ammo = this.def.mag;
    this.cooldown = 0;
    this.reloading = 0;
    this.triggerHeld = false;
  }

  get name() { return this.def.name; }
  get auto() { return this.def.auto; }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.ammo = this.def.mag; this.reloading = 0; }
    }
  }

  canFire() {
    return this.cooldown <= 0 && this.reloading <= 0 && this.ammo > 0;
  }

  startReload() {
    if (this.reloading > 0 || this.ammo === this.def.mag) return false;
    this.reloading = this.def.reload;
    return true;
  }

  // Fire one trigger pull. Returns null when it cannot fire, else a shot descriptor
  // the caller resolves against the world (raycast). `dir` is the aim direction.
  fire(origin, dir, moveSpread) {
    if (!this.canFire()) return null;
    const def = this.def;
    this.ammo -= 1;
    this.cooldown = 60 / def.rpm;
    const spread = def.spread * (1 + moveSpread * 2.2);
    const dirs = [];
    for (let p = 0; p < def.pellets; p += 1) {
      const d = dir.clone();
      d.x += (Math.random() * 2 - 1) * spread;
      d.y += (Math.random() * 2 - 1) * spread;
      d.z += (Math.random() * 2 - 1) * spread;
      d.normalize();
      dirs.push(d);
    }
    return { origin: origin.clone(), dirs, damage: def.damage, tracer: def.tracer, sound: def.sound };
  }
}

// Damage at `distance` metres: full up to 12 m, then linear falloff to 55% at 45 m.
export function damageAtRange(base, distance) {
  if (distance <= 12) return base;
  const t = Math.min(1, (distance - 12) / 33);
  return base * (1 - 0.45 * t);
}

// A fading tracer line. `scene` owns it; call update(dt) every frame and dispose when done.
export class Tracer {
  constructor(scene, from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    this.mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    this.line = new THREE.Line(geo, this.mat);
    this.life = 0.09;
    this.max = 0.09;
    scene.add(this.line);
  }

  update(dt) {
    this.life -= dt;
    this.mat.opacity = Math.max(0, (this.life / this.max) * 0.9);
    return this.life > 0;
  }

  dispose(scene) {
    scene.remove(this.line);
    this.line.geometry.dispose();
    this.mat.dispose();
  }
}
