import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { makeSkySystem } from '../vendor/eanpa-sky/engine/sky_system.js';
import { createCloudMotion } from '../vendor/eanpa-sky/engine/cloud_motion.js';

const scene = new THREE.Scene();
const textures = Object.fromEntries(['stars', 'starBackdrop', 'moon', 'cirrus'].map(name => {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 128]), 1, 1);
  texture.needsUpdate = true;
  return [name, texture];
}));
const hostDisposals = [];
for (const [name, texture] of Object.entries(textures)) texture.addEventListener('dispose', () => hostDisposals.push(name));
const sky = await makeSkySystem({ scene, textures, opts: {
  observerLatitudeDeg: 45.6, siderealAngle: 1.2, constellationVisibility: .4,
  skySamples: 28, lightSamples: 8, cloudPasses: 1, worldRayDir: true,
  domeRadius: 2500, outputDither: 0, stableCloudPhase: true,
} });
assert.equal(globalThis.makeSkySystem, undefined, 'the engine must not install a second global runtime');
assert.equal(scene.children.length, 2);
for (const dome of sky.domes) {
  assert.equal(dome.material.mrtNode, null, 'forward WebGPU materials must not stamp an empty MRT');
  assert.equal(dome.material.depthTest, true);
  assert.equal(dome.material.depthWrite, false);
}
assert.ok(Math.abs(sky.uniforms.observerLatitude.value - 45.6 * Math.PI / 180) < 1e-12);
const sun = new THREE.Vector3(.3, -.8, .2).normalize();
sky.setSunDirection(sun);
const assertDirection = (actual, expected) => assert.ok(actual.distanceTo(expected) < 1e-10);
assertDirection(sky.sunDir, sun);
// Both poles must produce a finite, orthonormal lunar tangent frame. Upstream's
// unguarded cross product returned a zero basis for these local seasonal inputs.
for (const moon of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(.3, .7, -.2).normalize()]) {
  sky.setMoonDirection(moon);
  const { moonRight, moonUp, moonDir, cloudLightDir } = sky.uniforms;
  for (const value of [moonRight.value, moonUp.value, moonDir.value]) assert.ok(Math.abs(value.length() - 1) < 1e-10);
  assert.ok(Math.abs(moonRight.value.dot(moonDir.value)) < 1e-10);
  assert.ok(Math.abs(moonUp.value.dot(moonDir.value)) < 1e-10);
  assertDirection(moonDir.value, moon);
  if (moon.y > 0) assertDirection(cloudLightDir.value, moon);
}
sky.setSiderealAngle(2.4);
sky.setConstellationVisibility(1);
const camera = new THREE.PerspectiveCamera(60, 1.6, .1, 2600);
camera.position.set(120, 40, -70);
sky.update(40000, camera);
sky.update(40001, camera);
assertDirection(sky.sunDir, sun);
assert.equal(sky.uniforms.siderealAngle.value, 2.4, 'animation must not replace the historical clock');
assert.equal(sky.uniforms.constellationVisibility.value, 1);
const pausedOffset = sky.uniforms.cloudDisplacement.value.clone();
sky.uniforms.skyWind.value.set(10, 0, 2);
sky.update(40001, camera);
assertDirection(sky.uniforms.cloudDisplacement.value, pausedOffset);
sky.update(40002, camera);
assertDirection(sky.uniforms.cloudDisplacement.value, pausedOffset.clone().add(new THREE.Vector3(10, 0, 2)));
for (const dome of sky.domes) assert.deepEqual(dome.position.toArray(), [120, 0, -70]);
const disposals = new Map();
const resources = [sky.cloudShadowMap.target, ...sky.domes.flatMap(dome => [dome.geometry, dome.material])];
for (const resource of resources) resource.addEventListener('dispose', () => disposals.set(resource, (disposals.get(resource) ?? 0) + 1));
sky.dispose(); sky.dispose();
assert.equal(scene.children.length, 0);
for (const resource of resources) assert.equal(disposals.get(resource), 1, 'each sky-owned resource must be released exactly once');
assert.deepEqual(hostDisposals, [], 'supplied celestial and cirrus textures remain host-owned');
for (const texture of Object.values(textures)) texture.dispose();

for (const steps of [10, 30, 60, 240]) {
  const motion = createCloudMotion();
  for (let i = 0; i <= steps; i++) motion.update(i / steps, { x: 2 + 8 * i / steps, z: 6 });
  assert.ok(Math.abs(motion.offset.x - 6) < 1e-10);
  assert.ok(Math.abs(motion.offset.z - 6) < 1e-10);
  const paused = { ...motion.offset };
  motion.update(1, { x: 80, z: 20 });
  motion.update(0, { x: 80, z: 20 });
  assert.deepEqual(motion.offset, paused, 'pauses and clock resets must not jump the cloud field');
}
console.log('Eanpa integration passed: historical clock, pole-safe moon, lighting refresh, cloud motion, and resource ownership.');
