import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

/** Execute the production methods without loading the browser-only world/asset graph. */
export async function testSceneManagerStartupContract(): Promise<void> {
  const source = readFileSync('src/scene/SceneManager.ts', 'utf8');
  const names = ['preloadTexture', 'precompileFirstPlayableObjects', 'waitForFirstPlayableGpuWork'];
  // Slice whole class methods at their two-space closing brace. No assertion
  // depends on a call expression or the internal implementation's spelling.
  const methods = names.map(name => {
    const match = source.match(new RegExp(`^  (?:async )?${name}\\([\\s\\S]*?^  \\}`, 'm'));
    assert.ok(match, `SceneManager retains ${name}`);
    return match[0];
  });
  const javascript = stripTypeScriptTypes(`class StartupProbe { ${methods.join('\n')} }`);
  const Probe = new Function(`${javascript}; return StartupProbe;`)();

  const events: string[] = [];
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const attached = new THREE.Group(), detached = new THREE.Group(), hidden = new THREE.Group();
  hidden.visible = false;
  scene.add(attached, hidden);
  let compileState = false, failCompile = false;
  let releaseCompile: () => void = () => {};
  let compileGate = Promise.resolve();
  const texture = new THREE.Texture();
  const renderer = {
    initTexture(value: THREE.Texture) { assert.equal(value, texture); events.push('upload'); },
    async compileAsync(root: THREE.Object3D, view: THREE.Camera) {
      assert.equal(root, scene, 'one visible-scene compile shares the live lighting context');
      assert.equal(view, camera);
      assert.equal(compileState, true, 'compilation must use the live scene-pass state');
      assert.equal(hidden.visible, false, 'warmup must not expose hidden woodland');
      events.push('compile');
      await compileGate;
      if (failCompile) throw Error('driver failure');
      events.push('compiled');
    },
  };
  const gpuDone = Promise.resolve();
  const owner = Object.assign(new Probe(), {
    renderer, scene, camera,
    sky: { preloadCelestialTexture(value: unknown) { assert.equal(value, renderer); events.push('sky-upload'); } },
    render(...args: unknown[]) {
      assert.deepEqual(args, [0, undefined, false, false, false, false, true]);
      events.push('prepare-visible-scene');
    },
    postProcessor: {
      async withSceneCompileState(compile: () => Promise<void>) {
        assert.equal(this, owner.postProcessor, 'the pass owner retains its receiver');
        compileState = true; events.push('enter-pass');
        try { await compile(); } finally { compileState = false; events.push('restore-pass'); }
      },
    },
    waitForSubmittedWork() { events.push('gpu-wait'); return gpuDone; },
  });

  owner.preloadTexture(texture);
  assert.deepEqual(events.splice(0), ['upload']);
  compileGate = new Promise<void>(resolve => { releaseCompile = resolve; });
  let finished = false;
  const work = owner.precompileFirstPlayableObjects([attached, attached, detached]).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'the startup barrier must await shader compilation');
  assert.deepEqual(events, ['sky-upload', 'prepare-visible-scene', 'enter-pass', 'compile']);
  releaseCompile(); await work;
  assert.deepEqual(events.splice(0), ['sky-upload', 'prepare-visible-scene', 'enter-pass', 'compile', 'compiled', 'restore-pass']);
  assert.equal(owner.waitForFirstPlayableGpuWork(), gpuDone);
  assert.deepEqual(events.splice(0), ['gpu-wait']);

  await owner.precompileFirstPlayableObjects([detached]);
  assert.equal(events.includes('compile'), false, 'detached roots must not trigger a scene compile');
  assert.equal(compileState, false);
  events.length = 0;
  failCompile = true;
  await assert.rejects(owner.precompileFirstPlayableObjects([attached]), /driver failure/);
  assert.equal(compileState, false, 'a failed compile must release the pass state');
  assert.equal(events.at(-1), 'restore-pass');
  assert.equal(hidden.visible, false);
  texture.dispose();
}
