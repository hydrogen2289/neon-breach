// main.js — bootstrap, player controller, shooting, and the game loop.
// Screens: title -> buy -> playing -> roundEnd -> buy ... -> matchEnd.
// ?shot=start|play|end stages a screenshot scene instead of the title screen.
import * as THREE from 'three';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Weapon, WEAPONS, Tracer, damageAtRange } from './weapons.js';
import { buildArena, resolveCollision } from './world.js';
import { BotManager, resolveHitscan } from './bots.js';
import { Match } from './game.js';
import { Hud } from './render.js';

const EYE_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.45;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 7.6;
const JUMP_VEL = 6.8;
const GRAVITY = 17;
const MOUSE_SENS = 0.0023;

const params = new URLSearchParams(window.location.search);
const shotParam = params.get('shot');

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const hud = new Hud();
const audio = new AudioEngine();
const input = new Input(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 200);
const arena = buildArena(scene);
const bots = new BotManager(scene, arena);
const raycaster = new THREE.Raycaster();

// The player, as the bots see it: a position, an alive flag and an invisible hitbox.
const playerHitbox = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.42, 1.7, 8),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
);
playerHitbox.position.y = 0.85;
playerHitbox.userData.isPlayer = true;
scene.add(playerHitbox);

const player = {
  name: 'YOU',
  team: 'cyan',
  pos: new THREE.Vector3(24, 0, -18),
  velY: 0,
  onGround: true,
  yaw: 0,
  pitch: 0,
  health: 100,
  maxHealth: 100,
  alive: true,
  weapon: new Weapon('pistol'),
  stepTimer: 0,
  spectate: null,
};

const tracers = [];
let prevMouseDown = false;

const match = new Match({
  onRoundEnd(winner, detail, reward) {
    if (winner === 'you') { audio.roundWin(); hud.banner('ROUND WON', `+${reward} credits`); }
    else if (winner === 'foe') { audio.roundLose(); hud.banner('ROUND LOST', `+${reward} credits`); }
    else hud.banner('ROUND DRAW', `+${reward} credits`);
    input.unlock();
    hud.roundEnd(winner, match.scoreYou, match.scoreFoe, detail);
    hud.showHud(true);
  },
  onMatchEnd(won) {
    if (won) audio.matchWin();
    input.unlock();
    hud.matchEnd(won, match.scoreYou, match.scoreFoe, match.kills, match.deaths);
  },
  onPhase(phase) {
    if (phase === 'buy') hud.setHint('Buy your gun, then start the round.');
    else if (phase === 'playing') hud.setHint('WASD move · SHIFT sprint · SPACE jump · R reload · B buy menu');
  },
});

function announce(msg) { statusEl.textContent = msg; }

function resetPlayerForRound() {
  player.pos.set(24, 0, -18);
  player.velY = 0;
  player.onGround = true;
  player.yaw = 0;
  player.pitch = 0;
  player.health = player.maxHealth;
  player.alive = true;
  player.spectate = null;
  player.weapon = new Weapon(match.weaponId);
  playerHitbox.position.set(player.pos.x, 0.85, player.pos.z);
  playerHitbox.visible = true;
}

function openBuy() {
  const onBuy = (id) => {
    const res = match.buyWeapon(id);
    if (res.ok) {
      audio.buy();
      openBuy();
    } else {
      audio.denied();
      hud.banner('CANNOT BUY', res.reason);
    }
  };
  hud.renderBuy(match.buyOptions(), match.credits, match.round, onBuy);
  hud.showScreen('buy');
  hud.showHud(false);
}

function startRound() {
  audio.ensure();
  bots.resetRound();
  resetPlayerForRound();
  match.beginRound();
  hud.showScreen(null);
  hud.showHud(true);
  input.lock();
  announce(`Round ${match.round}. Eliminate the enemy team.`);
}

function startMatch() {
  match.startMatch();
  openBuy();
}

// ---- shooting ----
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

function cameraDirection() {
  camera.getWorldDirection(_dir);
  return _dir;
}

function spawnTracer(from, to, color) {
  tracers.push(new Tracer(scene, from.clone(), to.clone(), color));
}

function playerShoot() {
  const w = player.weapon;
  if (!w.canFire()) {
    if (w.ammo === 0 && w.reloading <= 0) { w.startReload(); audio.reload(); }
    else if (w.ammo === 0) audio.dryFire();
    return;
  }
  camera.getWorldPosition(_origin);
  const moveSpread = (input.moveAxes().f || input.moveAxes().s) ? 1 : 0;
  const shot = w.fire(_origin, cameraDirection(), moveSpread);
  if (!shot) return;
  audio.shoot(shot.sound);
  // Muzzle flash point, slightly right and below the camera.
  _muzzle.copy(_origin).addScaledVector(_dir, 0.6);
  _muzzle.y -= 0.22;
  _muzzle.x += Math.cos(player.yaw) * 0.18;
  _muzzle.z -= Math.sin(player.yaw) * 0.18;
  for (const d of shot.dirs) {
    const hit = resolveHitscan(raycaster, _origin, d, 80, bots.hitMeshes(), arena.wallMeshes);
    const end = hit ? hit.point : _origin.clone().addScaledVector(d, 60);
    spawnTracer(_muzzle, end, shot.tracer);
    if (hit && hit.bot) {
      const dmg = damageAtRange(shot.damage, hit.distance);
      const killed = hit.bot.health - dmg <= 0;
      hit.bot.takeDamage(dmg, player, shootCtx);
      hud.hitmarker(killed);
      audio.hit();
      if (killed) audio.kill();
    }
  }
  // Recoil kick.
  player.pitch = Math.min(1.45, player.pitch + 0.011);
}

// Shared context handed to bots.
const shootCtx = {
  wallMeshes: arena.wallMeshes,
  colliders: arena.colliders,
  waypoints: arena.waypoints,
  camera,
  player,
  shoot(shooter, shot) {
    for (const d of shot.dirs) {
      // Never test the shooter's own body: the muzzle sits inside its head mesh.
      const targets = bots.hitMeshes().filter((m) => m.userData.bot !== shooter);
      if (player.alive) targets.push(playerHitbox);
      const hit = resolveHitscan(raycaster, shot.origin, d, 80, targets, arena.wallMeshes);
      const end = hit ? hit.point : shot.origin.clone().addScaledVector(d, 60);
      spawnTracer(shot.origin, end, shot.tracer);
      const distToPlayer = shot.origin.distanceTo(player.pos);
      audio.shoot(shot.sound, distToPlayer > 18);
      if (!hit) continue;
      if (hit.bot) {
        const dmg = damageAtRange(shot.damage, hit.distance);
        hit.bot.takeDamage(dmg, shooter, shootCtx);
      } else if (hit.hitObject && hit.hitObject.userData.isPlayer) {
        damagePlayer(damageAtRange(shot.damage, hit.distance), shooter);
      }
    }
  },
  onBotDown(bot, attacker) {
    const killer = attacker && attacker.name ? attacker.name : '???';
    const killerColor = attacker && attacker.team === 'cyan' ? '#22e6ff' : '#ff2d95';
    hud.killfeedAdd(killer, killerColor, bot.name, bot.team === 'cyan' ? '#22e6ff' : '#ff2d95');
    if (attacker === player) {
      match.noteKill();
      announce(`${bot.name} eliminated. ${match.kills} kills.`);
    }
  },
};

function damagePlayer(amount, attacker) {
  if (!player.alive || match.phase !== 'playing') return;
  player.health -= amount;
  hud.damageFlash();
  audio.hurt();
  if (player.health <= 0) {
    player.health = 0;
    player.alive = false;
    playerHitbox.visible = false;
    match.noteDeath();
    hud.banner('YOU ARE DOWN', 'Your squad fights on — spectating');
    announce('You are down. Spectating your squad.');
    player.spectate = bots.cyan.find((b) => b.alive) || null;
  }
}

// ---- per-frame updates ----
function updatePlayer(dt) {
  if (!player.alive) return;
  const { dx, dy } = input.consumeMouse();
  player.yaw -= dx * MOUSE_SENS;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * MOUSE_SENS));
  const axes = input.moveAxes();
  const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
  const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let mx = 0, mz = 0;
  if (axes.f || axes.s) {
    mx = -sin * axes.f + cos * axes.s;
    mz = -cos * axes.f - sin * axes.s;
    const len = Math.hypot(mx, mz) || 1;
    mx = (mx / len) * speed * dt;
    mz = (mz / len) * speed * dt;
  }
  player.pos.x += mx;
  player.pos.z += mz;
  resolveCollision(player.pos, PLAYER_RADIUS, arena.colliders);
  if ((input.down('Space')) && player.onGround) {
    player.velY = JUMP_VEL;
    player.onGround = false;
  }
  if (!player.onGround) {
    player.velY -= GRAVITY * dt;
    player.pos.y += player.velY * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.velY = 0; player.onGround = true; }
  }
  // Footsteps.
  if ((axes.f || axes.s) && player.onGround) {
    player.stepTimer -= dt;
    if (player.stepTimer <= 0) {
      player.stepTimer = sprint ? 0.28 : 0.38;
      audio.footstep();
    }
  }
  player.weapon.update(dt);
  // Firing: hold for autos, rising edge for semi-autos.
  const held = input.mouseDown;
  if (held && player.weapon.auto) playerShoot();
  else if (held && !prevMouseDown) playerShoot();
  prevMouseDown = held;
  playerHitbox.position.set(player.pos.x, 0.85, player.pos.z);
  camera.position.set(player.pos.x, EYE_HEIGHT + player.pos.y, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

function updateSpectate() {
  if (!player.spectate || !player.spectate.alive) {
    player.spectate = bots.cyan.find((b) => b.alive) || bots.magenta.find((b) => b.alive) || null;
  }
  const b = player.spectate;
  if (!b) return;
  camera.position.set(b.pos.x, 2.4, b.pos.z);
  _dir.set(Math.sin(b.yaw), -0.08, Math.cos(b.yaw));
  camera.lookAt(b.pos.x + _dir.x * 5, 1.4, b.pos.z + _dir.z * 5);
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    if (!tracers[i].update(dt)) {
      tracers[i].dispose(scene);
      tracers.splice(i, 1);
    }
  }
}

function pushHud() {
  const aliveYou = (player.alive ? 1 : 0) + bots.aliveCount('cyan');
  const aliveFoe = bots.aliveCount('magenta');
  hud.update({
    health: player.health,
    maxHealth: player.maxHealth,
    weaponName: player.weapon.name,
    ammo: player.weapon.ammo,
    mag: player.weapon.def.mag,
    reserve: Infinity,
    reloading: player.weapon.reloading > 0,
    credits: match.credits,
    round: match.round,
    scoreYou: match.scoreYou,
    scoreFoe: match.scoreFoe,
    timer: match.timer,
    aliveYou,
    aliveFoe,
  });
  return { aliveYou, aliveFoe };
}

// ---- input wiring ----
input.onKey = (code) => {
  if (match.phase === 'buy') {
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
    if (idx >= 0) {
      const opts = match.buyOptions();
      if (opts[idx]) {
        const res = match.buyWeapon(opts[idx].id);
        if (res.ok) { audio.buy(); openBuy(); }
        else { audio.denied(); hud.banner('CANNOT BUY', res.reason); }
      }
    }
    if (code === 'Enter') startRound();
    return;
  }
  if (match.phase === 'playing') {
    if (code === 'KeyR') {
      if (player.weapon.startReload()) audio.reload();
    } else if (code === 'KeyB') {
      hud.banner('ARMORY OPENS BETWEEN ROUNDS', 'Finish the round first');
    }
  }
};

input.onLockChange = (locked) => {
  if (match.phase !== 'playing') return;
  if (!locked && player.alive) hud.showScreen('lock');
  else if (locked) hud.showScreen(null);
};

document.getElementById('btn-deploy').addEventListener('click', () => { audio.ensure(); audio.click(); startMatch(); });
document.getElementById('btn-start-round').addEventListener('click', () => { audio.click(); startRound(); });
document.getElementById('btn-next-round').addEventListener('click', () => {
  audio.click();
  if (match.phase === 'matchEnd') return;
  match.nextRound();
  openBuy();
});
document.getElementById('btn-restart').addEventListener('click', () => { audio.click(); startMatch(); });
document.getElementById('btn-relock').addEventListener('click', () => { input.lock(); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) input.unlock();
});

// ---- screenshot staging (?shot=start|play|end) ----
function stageShot(name) {
  if (name === 'end') {
    match.scoreYou = 5;
    match.scoreFoe = 3;
    match.kills = 11;
    match.deaths = 2;
    match.phase = 'matchEnd';
    hud.matchEnd(true, 5, 3, 11, 2);
    hud.showHud(false);
  } else if (name === 'play') {
    match.startMatch();
    match.round = 2;
    match.scoreYou = 1;
    match.scoreFoe = 1;
    match.credits = 2400;
    match.kills = 2;
    match.weaponId = 'rifle';
    match.owned = ['pistol', 'rifle'];
    bots.resetRound();
    resetPlayerForRound();
    player.health = 82;
    player.weapon = new Weapon('rifle');
    player.weapon.ammo = 17;
    // Stage the player mid-arena, facing the enemy half, with bots in view.
    player.pos.set(-6, 0, -6);
    player.yaw = 0.35;
    player.pitch = -0.02;
    camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    const foes = bots.magenta;
    foes[0].pos.set(4, 0, 6); foes[0].group.position.set(4, 0, 6);
    foes[1].pos.set(-14, 0, 2); foes[1].group.position.set(-14, 0, 2);
    foes[2].pos.set(10, 0, -2); foes[2].group.position.set(10, 0, -2);
    foes[0].yaw = Math.PI; foes[0].group.rotation.y = Math.PI;
    match.beginRound();
    match.timer = 73;
    hud.showScreen(null);
    hud.showHud(true);
    hud.killfeedAdd('YOU', '#22e6ff', 'HAVOC', '#ff2d95');
    hud.banner('ROUND 2', 'First to 5 rounds takes the match');
    pushHud();
  }
  // 'start' (or anything else) is just the title screen, already shown.
  renderer.render(scene, camera);
  requestAnimationFrame(() => {
    renderer.render(scene, camera);
    window.__shotReady = true;
  });
}

// ---- main loop ----
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (match.phase === 'playing') {
    updatePlayer(dt);
    bots.update(dt, shootCtx);
    const counts = pushHud();
    match.update(dt, counts.aliveYou, counts.aliveFoe);
  } else {
    // Idle scene behind the menus: slow camera orbit over the arena.
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.08) * 26, 14, Math.cos(t * 0.08) * 18);
    camera.lookAt(0, 1, 0);
    if (match.phase !== 'buy' && match.phase !== 'title') pushHud();
  }
  if (match.phase === 'playing' && !player.alive) updateSpectate();
  updateTracers(dt);
  renderer.render(scene, camera);
}

if (shotParam) {
  stageShot(shotParam);
} else {
  announce('Neon Breach. Click DEPLOY to start.');
  requestAnimationFrame(frame);
}
