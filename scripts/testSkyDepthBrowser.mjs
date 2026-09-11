import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// Isolate depth from stochastic cloud density: opaque cyan clouds must never
// cover the magenta receiver, even beyond the physical sky mesh's radius.
const out = process.env.SKY_DEPTH_OUTPUT ?? 'artifacts/sky-depth';
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
    if (message.type() === 'error' || /validation error|invalid shader/i.test(message.text())) errors.push(message.text());
  });
  await page.route('**/sky-depth-probe', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
  await page.goto(new URL('sky-depth-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE, TSL } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { SkyCloudMesh } = await import('/src/sky/SkyCloudMesh.ts');
    const { MAP_SIZE_PRESETS } = await import('/src/world/worldGenerationSettings.ts');
    const { LIVE_WORLD_MAX_DISTANCE } = await import('/src/camera/CameraCurves.ts');
    const { computeWorldCameraFarPlane } = await import('/src/sky/skyDepthOcclusionPolicy.ts');
    const backend = await createPreferredRenderer(), renderer = backend.renderer;
    renderer.setSize(640, 400); renderer.setPixelRatio(1); renderer.toneMapping = THREE.NoToneMapping;
    const target = new THREE.RenderTarget(640, 400);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
    const sky = new SkyCloudMesh({ rendererBackend: backend.kind });
    scene.add(sky); await sky.ready;
    for (const dome of sky.children) {
      dome.material.fragmentNode = TSL.vec4(0, 1, 1, 1);
      dome.material.needsUpdate = true;
    }
    const camera = new THREE.PerspectiveCamera(60, 1.6, .1, 2600);
    const receiver = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({ color: 0xff00ff }));
    scene.add(receiver);
    const rows = [], images = [];
    async function pixels() {
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      return new Uint8Array(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 640, 400));
    }
    function save(name, bytes) {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes), 640, 400), 0, 0);
      images.push({ name, data: canvas.toDataURL() });
    }
    for (const [size, dimensions] of Object.entries(MAP_SIZE_PRESETS)) {
      camera.far = computeWorldCameraFarPlane({ ...dimensions, maxOrbitDistance: LIVE_WORLD_MAX_DISTANCE });
      camera.updateProjectionMatrix();
      for (const height of [4, 384, 700]) {
        camera.position.set(dimensions.playableHalf, height, dimensions.playableHalf);
        for (const pitch of [-70, 0, 70]) {
          const angle = THREE.MathUtils.degToRad(pitch);
          const direction = new THREE.Vector3(-Math.cos(angle) / Math.SQRT2, Math.sin(angle), -Math.cos(angle) / Math.SQRT2);
          camera.lookAt(camera.position.clone().add(direction)); camera.updateMatrixWorld(true);
          sky.updateCamera(camera); sky.updateTime(100);
          receiver.position.copy(camera.position).addScaledVector(direction, camera.far * .98);
          receiver.quaternion.copy(camera.quaternion);
          receiver.scale.set(camera.far * .6, camera.far * .4, 1);
          sky.visible = false; receiver.visible = true;
          const reference = await pixels();
          sky.visible = true;
          const combined = await pixels();
          let receiverPixels = 0, overwritten = 0;
          for (let i = 0; i < reference.length; i += 4) {
            if (reference[i] > 250 && reference[i + 1] < 3 && reference[i + 2] > 250) {
              receiverPixels++;
              if (combined[i] < 250 || combined[i + 1] > 3 || combined[i + 2] < 250) overwritten++;
            }
          }
          receiver.visible = false;
          const background = await pixels();
          let holes = 0;
          for (let i = 0; i < background.length; i += 4) if (background[i + 1] < 200 || background[i + 2] < 200) holes++;
          rows.push({ size, height, pitch, far: camera.far, receiverPixels, overwritten, holes });
          if (height === 384 && pitch === 0) save(`${size}-far-occlusion`, combined);
          if (height === 700 && pitch === -70) save(`${size}-elevated-sky`, background);
        }
      }
    }
    sky.dispose(); receiver.geometry.dispose(); receiver.material.dispose(); target.dispose(); renderer.dispose();
    return { rows, images, adapter: backend.adapterEvidence };
  });
  for (const image of result.images) writeFileSync(`${out}/${image.name}.png`, Buffer.from(image.data.split(',')[1], 'base64'));
  delete result.images;
  writeFileSync(`${out}/regression.json`, JSON.stringify({ result, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const row of result.rows) {
    const name = `${row.size}, y=${row.height}, pitch=${row.pitch}`;
    assert.ok(row.receiverPixels > 10_000, `${name}: distant geometry remains inside the far plane`);
    assert.equal(row.overwritten, 0, `${name}: sky/clouds must stay behind distant geometry`);
    assert.equal(row.holes, 0, `${name}: sky must cover the viewport without far-plane clipping`);
  }
  console.log(`Sky depth passed: ${result.rows.length} map/height/pitch views; no occlusion errors or sky holes.`);
} finally {
  await browser?.close(); await server.close();
}
