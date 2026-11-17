// bots.js — bot agents. Each bot patrols waypoints, engages visible enemies with
// burst fire, strafes, and retreats when hurt. The same hitscan resolver serves
// player shots and bot shots.
import * as THREE from 'three';
import { Weapon } from './weapons.js';
import { hasLineOfSight, resolveCollision } from './world.js';

// Resolve one hitscan ray. Returns { point, distance, bot|null, wall, hitObject } —
// the nearest of the hittable meshes and the walls, or null when nothing is hit.
export function resolveHitscan(raycaster, origin, dir, maxDist, hitMeshes, wallMeshes) {
  raycaster.set(origin, dir);
  raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(hitMeshes, false);
  const walls = raycaster.intersectObjects(wallMeshes, false);
  let best = null;
  if (hits.length > 0) {
    best = { point: hits[0].point, distance: hits[0].distance, bot: hits[0].object.userData.bot || null, wall: false, hitObject: hits[0].object };
  }
  if (walls.length > 0 && (!best || walls[0].distance < best.distance)) {
    best = { point: walls[0].point, distance: walls[0].distance, bot: null, wall: true, hitObject: walls[0].object };
  }
  return best;
}

const BOT_NAMES = {
  cyan: ['VEX', 'NOVA', 'ORBIT', 'PULSE'],
  magenta: ['RAZOR', 'HAVOC', 'SPECTRE', 'WRAITH', 'DUSK'],
};

const TEAM_COLOR = { cyan: 0x22e6ff, magenta: 0xff2d95 };
const TEAM_COLOR_HEX = { cyan: '#22e6ff', magenta: '#ff2d95' };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class Bot {
  constructor(scene, team, index, arena) {
    this.team = team;
    this.name = BOT_NAMES[team][index % BOT_NAMES[team].length];
    this.arena = arena;
    this.health = 100;
    this.alive = true;
    this.weapon = new Weapon('rifle');
    this.yaw = team === 'cyan' ? 0 : Math.PI;
    this.pos = new THREE.Vector3(0, 0, team === 'cyan' ? -18 : 18);
    this.speed = 3.4;
    this.skill = 0.8 + Math.random() * 0.15;
    this.state = 'patrol';
    this.waypoint = null;
    this.idleTimer = 0;
    this.aimTimer = 0;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.pauseTimer = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 0;
    this.target = null;
    this.noContactTimer = 0;
    this.deathTimer = 0;
    this.stepTimer = Math.random() * 0.5;

    const color = TEAM_COLOR[team];
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.5, metalness: 0.6, emissive: color, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.15, 10), bodyMat);
    body.position.y = 0.85;
    body.userData.bot = this;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), bodyMat);
    head.position.y = 1.62;
    head.userData.bot = this;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.06),
      new THREE.MeshBasicMaterial({ color }));
    visor.position.set(0, 1.64, 0.24);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x11131c, roughness: 0.4, metalness: 0.8 }));
    gun.position.set(0.22, 1.05, 0.45);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    // Health bar above the head.
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x11131c, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    barBg.position.y = 2.05;
    const barFg = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x39ff88, side: THREE.DoubleSide }));
    barFg.position.set(0, 2.05, 0.01);
    this.group.add(body, head, visor, gun, ring, barBg, barFg);
    this.bodyMesh = body;
    this.headMesh = head;
    this.barFg = barFg;
    this.hitMeshes = [body, head];
    scene.add(this.group);
    this.scene = scene;
  }

  get colorHex() { return TEAM_COLOR_HEX[this.team]; }
  get eyePos() { _eye.set(this.pos.x, 1.55, this.pos.z); return _eye; }

  reset(spawn) {
    this.health = 100;
    this.alive = true;
    this.pos.set(spawn[0], 0, spawn[1]);
    this.yaw = this.team === 'cyan' ? 0 : Math.PI;
    this.state = 'patrol';
    this.waypoint = null;
    this.noContactTimer = 0;
    this.idleTimer = Math.random() * 0.5;
    this.burstLeft = 0;
    this.group.visible = true;
    this.group.rotation.set(0, this.yaw, 0);
    this.group.position.copy(this.pos);
    this.barFg.scale.x = 1;
    this.barFg.material.color.set(0x39ff88);
  }

  takeDamage(amount, attacker, ctx) {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deathTimer = 0;
      this.group.rotation.x = -Math.PI / 2;
      this.group.position.y = 0.35;
      if (ctx && ctx.onBotDown) ctx.onBotDown(this, attacker);
    }
    this.barFg.scale.x = Math.max(0.001, this.health / 100);
    this.barFg.material.color.set(this.health > 50 ? 0x39ff88 : this.health > 25 ? 0xffb020 : 0xff4040);
  }

  // Pick the nearest living enemy with line of sight.
  acquireTarget(enemies, player, wallMeshes) {
    let best = null;
    let bestD = 46;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = this.pos.distanceTo(e.pos);
      if (d > bestD) continue;
      _v1.set(e.pos.x, 1.4, e.pos.z);
      if (!hasLineOfSight(this.eyePos, _v1, wallMeshes)) continue;
      best = e; bestD = d;
    }
    if (player && player.alive) {
      const d = this.pos.distanceTo(player.pos);
      if (d < bestD) {
        _v1.set(player.pos.x, 1.4, player.pos.z);
        if (hasLineOfSight(this.eyePos, _v1, wallMeshes)) {
          best = player; bestD = d;
        }
      }
    }
    return best;
  }

  update(dt, ctx) {
    if (!this.alive) {
      this.deathTimer += dt;
      if (this.deathTimer > 4) this.group.visible = false;
      return;
    }
    this.weapon.update(dt);
    const foes = this.team === 'cyan' ? ctx.magenta : ctx.cyan;
    const allies = this.team === 'cyan' ? ctx.cyan : ctx.magenta;
    // Re-acquire every 0.25 s or when the target died.
    this.aimTimer -= dt;
    if (this.aimTimer <= 0 || (this.target && !this.target.alive)) {
      this.aimTimer = 0.25;
      const playerTarget = this.team === 'magenta' ? ctx.player : null;
      this.target = this.acquireTarget(foes, playerTarget, ctx.wallMeshes);
      if (this.target && this.state !== 'engage') {
        this.state = 'engage';
        this.burstLeft = 0;
        this.pauseTimer = 0.45 + Math.random() * 0.4; // aim delay
      } else if (!this.target && this.state === 'engage') {
        this.state = this.health < 30 ? 'retreat' : 'patrol';
      }
    }
    if (this.health < 30 && this.state !== 'engage') this.state = 'retreat';
    if (this.target) this.noContactTimer = 0;
    else this.noContactTimer += dt;

    let moveX = 0, moveZ = 0;
    if (this.state === 'engage' && this.target) {
      const t = this.target;
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(dx, dz);
      // Strafe, keep 8–20 m.
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 0.8 + Math.random() * 1.2;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const px = -dz / dist * this.strafeDir;
      const pz = dx / dist * this.strafeDir;
      const approach = dist > 20 ? 1 : dist < 7 ? -0.8 : 0;
      moveX = px * 0.9 + (dx / dist) * approach;
      moveZ = pz * 0.9 + (dz / dist) * approach;
      this.fireAtTarget(dt, ctx, dist);
    } else if (this.state === 'retreat') {
      const home = this.team === 'cyan' ? -18 : 18;
      const dx = 0 - this.pos.x;
      const dz = home - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      moveX = dx / dist;
      moveZ = dz / dist;
      this.yaw = Math.atan2(dx, dz);
      if (Math.abs(this.pos.z - home) < 3 && Math.abs(this.pos.x) < 6) this.state = 'patrol';
    } else {
      // Patrol between waypoints.
      if (!this.waypoint || (this.idleTimer > 0 && this.pos.distanceTo(this.waypoint) < 1.2)) {
        if (this.idleTimer > 0) {
          this.idleTimer -= dt;
          if (this.idleTimer <= 0) this.waypoint = null;
        } else {
          // Hunt: after 6 s without contact, push toward the enemy half so the
          // squads actually meet instead of wandering their own spawn forever.
          const wps = ctx.waypoints;
          let pool = wps;
          if (this.noContactTimer > 12) {
            const foeSide = this.team === 'cyan' ? 1 : -1;
            const near = wps.filter((w) => Math.sign(w.z) === foeSide || Math.abs(w.z) < 8);
            if (near.length > 0) pool = near;
          }
          this.waypoint = pool[Math.floor(Math.random() * pool.length)];
          if (this.pos.distanceTo(this.waypoint) < 2) this.waypoint = null;
        }
      }
      if (this.waypoint) {
        const dx = this.waypoint.x - this.pos.x;
        const dz = this.waypoint.z - this.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        moveX = dx / dist;
        moveZ = dz / dist;
        this.yaw = Math.atan2(dx, dz);
        if (dist < 1.2) { this.waypoint = null; this.idleTimer = 0.5 + Math.random() * 1.2; }
      }
    }

    // Step + slide.
    const sp = this.state === 'engage' ? 4.4 : 3.2;
    this.pos.x += moveX * sp * dt;
    this.pos.z += moveZ * sp * dt;
    resolveCollision(this.pos, 0.45, ctx.colliders);
    this.group.position.set(this.pos.x, 0, this.pos.z);
    this.group.rotation.y = this.yaw;
    // Bob while walking.
    this.stepTimer += dt * (moveX || moveZ ? 9 : 0);
    this.group.position.y = Math.abs(Math.sin(this.stepTimer)) * 0.04;
    // Health bar always faces the camera.
    if (ctx.camera) {
      this.barFg.lookAt(ctx.camera.position);
      this.group.children[5].lookAt(ctx.camera.position);
    }
  }

  fireAtTarget(dt, ctx, dist) {
    if (this.pauseTimer > 0) { this.pauseTimer -= dt; return; }
    if (this.burstLeft <= 0) {
      if (this.burstTimer > 0) { this.burstTimer -= dt; return; }
      this.burstLeft = 4 + Math.floor(Math.random() * 3);
      this.burstTimer = 0;
    }
    if (!this.weapon.canFire()) return;
    this.burstLeft -= 1;
    if (this.burstLeft === 0) this.burstTimer = 0.9 + Math.random() * 0.7;
    const t = this.target;
    // Aim at the chest with skill-based error that grows with distance.
    const err = (1 - this.skill * 0.55) * (0.2 + dist * 0.03);
    _v1.set(
      t.pos.x + (Math.random() * 2 - 1) * err,
      1.35 + (Math.random() * 2 - 1) * err * 0.6,
      t.pos.z + (Math.random() * 2 - 1) * err,
    );
    _v2.set(this.pos.x, 1.45, this.pos.z);
    const dir = _v1.sub(_v2).normalize();
    const shot = this.weapon.fire(_v2, dir, 0);
    if (!shot) return;
    shot.damage *= 0.7; // Bots hit softer than the player: squads last longer, rounds breathe.
    ctx.shoot(this, shot, t);
  }
}

export class BotManager {
  constructor(scene, arena) {
    this.scene = scene;
    this.arena = arena;
    this.cyan = [];
    this.magenta = [];
    for (let i = 0; i < 4; i += 1) this.cyan.push(new Bot(scene, 'cyan', i, arena));
    for (let i = 0; i < 5; i += 1) this.magenta.push(new Bot(scene, 'magenta', i, arena));
  }

  all() { return this.cyan.concat(this.magenta); }

  resetRound() {
    const sp = this.arena.spawns;
    this.cyan.forEach((b, i) => b.reset(sp.cyan[i]));
    this.magenta.forEach((b, i) => b.reset(sp.magenta[i]));
  }

  aliveCount(team) {
    const list = team === 'cyan' ? this.cyan : this.magenta;
    let n = 0;
    for (const b of list) if (b.alive) n += 1;
    return n;
  }

  update(dt, ctx) {
    const full = {
      ...ctx,
      cyan: this.cyan,
      magenta: this.magenta,
    };
    for (const b of this.all()) b.update(dt, full);
  }

  hitMeshes() {
    const out = [];
    for (const b of this.all()) if (b.alive) out.push(b.bodyMesh, b.headMesh);
    return out;
  }
}
