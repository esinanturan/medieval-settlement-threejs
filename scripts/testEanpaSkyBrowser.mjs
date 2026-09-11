import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.EANPA_SKY_OUTPUT ?? 'artifacts/eanpa-sky';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /validation error|invalid shader|Error while parsing WGSL/i.test(message.text())) errors.push(message.text());
  });
  await page.route('**/eanpa-sky-probe', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"></body>' }));
  await page.goto(new URL('eanpa-sky-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { SkyCloudMesh } = await import('/src/sky/SkyCloudMesh.ts');
    const backend = await createPreferredRenderer();
    const renderer = backend.renderer;
    renderer.setSize(640, 400);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    document.body.append(renderer.domElement);
    const target = new THREE.RenderTarget(640, 400);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1.6, .1, 2600);
    camera.position.set(0, 4, 0);
    camera.lookAt(0, 100, -200);
    const sky = new SkyCloudMesh({ rendererBackend: backend.kind });
    scene.add(sky);
    await sky.ready;
    await sky.loadCelestialSky();
    sky.preloadCelestialTexture(renderer);
    sky.updateCamera(camera);
    // A bright foreground object detects sky depth/composition regressions.
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicNodeMaterial({ color: 0xff00ff }));
    blocker.position.set(0, 5, -12);
    scene.add(blocker);
    const captures = [];
    const rawCaptures = new Map();
    async function capture(name) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 640, 400);
      const data = new Uint8Array(raw);
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 400;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), 640, 400), 0, 0);
      let energy = 0, magenta = 0, nonblack = 0;
      for (let i = 0; i < data.length; i += 4) {
        energy += data[i] + data[i + 1] + data[i + 2];
        if (data[i] + data[i + 1] + data[i + 2] > 10) nonblack++;
        if (data[i] > 180 && data[i + 1] < 30 && data[i + 2] > 180) magenta++;
      }
      rawCaptures.set(name, data);
      captures.push({ name, mean: energy / (640 * 400 * 3), nonblack, magenta, image: canvas.toDataURL() });
    }
    for (const [name, sun] of [
      ['day', [.5, .7, -.5]], ['sunset', [.8, .015, -.6]], ['night', [.4, -.8, -.3]],
    ]) {
      sky.updateSun(new THREE.Vector3(...sun));
      sky.updateTime(100);
      sky.updateSiderealAngle(1.2);
      sky.updateConstellationVisibility(0);
      await capture(name);
    }
    await capture('night-paused');
    sky.updateConstellationVisibility(1);
    await capture('night-guides');
    sky.updateConstellationVisibility(0);
    sky.updateSiderealAngle(2.4);
    await capture('night-season');
    sky.updateSun(new THREE.Vector3(0, -1, 0));
    camera.lookAt(0, 100, 0.01);
    sky.updateTime(100);
    await capture('moon-zenith');
    const difference = (a, b) => {
      const first = rawCaptures.get(a), second = rawCaptures.get(b);
      let changed = 0;
      for (let i = 0; i < first.length; i += 4) if (first[i] !== second[i] || first[i + 1] !== second[i + 1] || first[i + 2] !== second[i + 2]) changed++;
      return changed;
    };
    const differences = { paused: difference('night', 'night-paused'), guides: difference('night', 'night-guides'), sidereal: difference('night', 'night-season') };
    sky.dispose(); sky.dispose();
    blocker.geometry.dispose(); blocker.material.dispose();
    target.dispose(); renderer.dispose();
    return { captures, differences, adapter: backend.adapterEvidence, backend: backend.kind, remainingSkyChildren: sky.children.length };
  });
  for (const capture of result.captures) {
    writeFileSync(`${out}/${capture.name}.png`, Buffer.from(capture.image.split(',')[1], 'base64'));
    delete capture.image;
  }
  writeFileSync(`${out}/regression.json`, JSON.stringify({ result, errors }, null, 2));
  assert.deepEqual(errors, [], 'the sky must compile and render without browser/GPU errors');
  assert.equal(result.backend, 'webgpu');
  assert.equal(result.remainingSkyChildren, 0);
  assert.equal(result.differences.paused, 0, 'a paused sky must not drift or flicker');
  assert.ok(result.differences.guides > 100, 'constellation guides must remain independently visible');
  assert.ok(result.differences.sidereal > 100, 'historical stars must rotate with the season');
  for (const name of ['day', 'sunset', 'night']) {
    const capture = result.captures.find(item => item.name === name);
    assert.ok(capture.nonblack > 100_000, `${name} sky must remain visible`);
    assert.ok(capture.magenta > 100, `${name} sky must remain behind opaque geometry`);
  }
  assert.ok(result.captures.find(c => c.name === 'day').mean > result.captures.find(c => c.name === 'night').mean);
  console.log(JSON.stringify({ ...result, errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
