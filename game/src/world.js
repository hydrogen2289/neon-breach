// world.js — the Neon Breach arena: floor, walls, cover, platforms, lights and fog.
// Collision is axis-aligned boxes in the XZ plane; bots and the player slide along them.
import * as THREE from 'three';

export const ARENA = { halfX: 32, halfZ: 22, wallHeight: 4 };

const MAT = {
  floor: new THREE.MeshStandardMaterial({ color: 0x0b0e1a, roughness: 0.85, metalness: 0.2 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x151a2e, roughness: 0.7, metalness: 0.35 }),
  block: new THREE.MeshStandardMaterial({ color: 0x1b2140, roughness: 0.6, metalness: 0.45 }),
  deck: new THREE.MeshStandardMaterial({ color: 0x232a4a, roughness: 0.55, metalness: 0.5 }),
  core: new THREE.MeshStandardMaterial({ color: 0x10142a, roughness: 0.5, metalness: 0.6, emissive: 0x1a0b2e, emissiveIntensity: 0.6 }),
  cyanGlow: new THREE.MeshBasicMaterial({ color: 0x22e6ff }),
  pinkGlow: new THREE.MeshBasicMaterial({ color: 0xff2d95 }),
  amberGlow: new THREE.MeshBasicMaterial({ color: 0xffb020 }),
};

// One cover block: [x, z, width, depth, height, material]
const BLOCKS = [
  [0, 0, 10, 6, 3.0, 'core'], // central core
  [-14, -8, 6, 2, 2.4, 'block'], [14, -8, 6, 2, 2.4, 'block'],
  [-14, 8, 6, 2, 2.4, 'block'], [14, 8, 6, 2, 2.4, 'block'],
  [-22, 0, 2, 8, 1.2, 'deck'], [22, 0, 2, 8, 1.2, 'deck'],
  [-7, -14, 4, 2, 1.1, 'deck'], [7, -14, 4, 2, 1.1, 'deck'],
  [-7, 14, 4, 2, 1.1, 'deck'], [7, 14, 4, 2, 1.1, 'deck'],
  [-26, -14, 3, 3, 2.2, 'block'], [26, -14, 3, 3, 2.2, 'block'],
  [-26, 14, 3, 3, 2.2, 'block'], [26, 14, 3, 3, 2.2, 'block'],
  [0, -18, 8, 1.5, 1.0, 'deck'], [0, 18, 8, 1.5, 1.0, 'deck'],
];

export const WAYPOINTS = [
  [-26, -18], [-12, -18], [0, -16], [12, -18], [26, -18],
  [-26, -8], [-20, 0], [-10, -4], [10, -4], [20, 0], [26, -8],
  [-18, 8], [-8, 12], [0, 8], [8, 12], [18, 8],
  [-26, 18], [-12, 18], [0, 16], [12, 18], [26, 18],
  [-28, 0], [28, 0], [0, -10], [0, 10],
];

const SPAWNS = {
  cyan: [[-24, -18], [-12, -19], [0, -19], [12, -19], [24, -18]],
  magenta: [[-24, 18], [-12, 19], [0, 19], [12, 19], [24, 18]],
};

// Push a circle (pos.x, pos.z, radius) out of every AABB it overlaps. Two passes for corners.
export function resolveCollision(pos, radius, colliders) {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const px = Math.min(pos.x - c.minX + radius, c.maxX - pos.x + radius);
        const pz = Math.min(pos.z - c.minZ + radius, c.maxZ - pos.z + radius);
        if (px < pz) pos.x += (pos.x - (c.minX + c.maxX) / 2 >= 0 ? px : -px);
        else pos.z += (pos.z - (c.minZ + c.maxZ) / 2 >= 0 ? pz : -pz);
      }
    }
  }
  // Clamp inside the arena walls.
  pos.x = Math.max(-ARENA.halfX + 0.6, Math.min(ARENA.halfX - 0.6, pos.x));
  pos.z = Math.max(-ARENA.halfZ + 0.6, Math.min(ARENA.halfZ - 0.6, pos.z));
}

// True when nothing solid stands between two eye positions (walls and blocks only).
const _losRay = new THREE.Raycaster();
const _losDir = new THREE.Vector3();
export function hasLineOfSight(a, b, wallMeshes) {
  _losDir.copy(b).sub(a);
  const dist = _losDir.length();
  if (dist < 0.001) return true;
  _losDir.multiplyScalar(1 / dist);
  _losRay.set(a, _losDir);
  _losRay.far = dist;
  return _losRay.intersectObjects(wallMeshes, false).length === 0;
}

export function buildArena(scene) {
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.FogExp2(0x05060f, 0.011);

  const colliders = [];
  const wallMeshes = [];

  function addBox(x, z, w, d, h, mat, glow = null) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    scene.add(mesh);
    wallMeshes.push(mesh);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    if (glow) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.08, d + 0.06), glow);
      strip.position.set(x, h + 0.04, z);
      scene.add(strip);
    }
    return mesh;
  }

  // Floor + neon grid.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.halfX * 2, ARENA.halfZ * 2), MAT.floor);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(ARENA.halfX * 2, 32, 0x1de9ff, 0x12324a);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  // Perimeter walls with glowing tops.
  const { halfX, halfZ, wallHeight } = ARENA;
  addBox(0, -halfZ, halfX * 2 + 1, 1, wallHeight, MAT.wall, MAT.cyanGlow);
  addBox(0, halfZ, halfX * 2 + 1, 1, wallHeight, MAT.wall, MAT.pinkGlow);
  addBox(-halfX, 0, 1, halfZ * 2, wallHeight, MAT.wall);
  addBox(halfX, 0, 1, halfZ * 2, wallHeight, MAT.wall);

  // Cover blocks, decks and the central core.
  for (const [x, z, w, d, h, kind] of BLOCKS) {
    const glow = kind === 'core' ? MAT.pinkGlow : kind === 'deck' ? MAT.cyanGlow : null;
    addBox(x, z, w, d, h, MAT[kind], glow);
  }

  // Glowing corner pillars.
  for (const [x, z, mat] of [[-29, -19, MAT.cyanGlow], [29, -19, MAT.cyanGlow], [-29, 19, MAT.pinkGlow], [29, 19, MAT.pinkGlow]]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), mat);
    pillar.position.set(x, 2.5, z);
    scene.add(pillar);
  }

  // Lights: dim ambient, one sun, and coloured points over each half.
  scene.add(new THREE.AmbientLight(0x8090b0, 0.55));
  const sun = new THREE.DirectionalLight(0xbfd8ff, 0.9);
  sun.position.set(18, 30, 12);
  scene.add(sun);
  const p1 = new THREE.PointLight(0x22e6ff, 60, 40, 1.8);
  p1.position.set(-16, 6, -10);
  scene.add(p1);
  const p2 = new THREE.PointLight(0xff2d95, 60, 40, 1.8);
  p2.position.set(16, 6, 10);
  scene.add(p2);
  const p3 = new THREE.PointLight(0xffb020, 25, 25, 1.8);
  p3.position.set(0, 5, 0);
  scene.add(p3);

  return {
    colliders,
    wallMeshes,
    spawns: SPAWNS,
    waypoints: WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  };
}
