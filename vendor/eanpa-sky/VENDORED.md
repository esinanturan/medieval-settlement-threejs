# Vendored Eanpa Sky

- Upstream: https://github.com/SkyeShark/Eanpa-Sky
- Version: 0.2.1 (including upstream follow-ups through 2026-09-11)
- Commit: `c8a3571f0e3718cba0c92e5a849d5d2dd06150c2`
- Release tag: `v0.2.1` (`f2a359493f8f7fc553c6e26c8716072f398d9f95`)
- License: MIT (see `LICENSE`)

Included runtime files:

- `engine/sky_system.js`: Eanpa's world-space WebGPU/TSL atmospheric and
  volumetric cloud engine.
- `engine/cloud_shadow_map.js`: shared, temporally blended cloud-shadow field.
- `engine/cloud_motion.js`: continuous wind integration across weather changes.
- `engine/sky_noise.js`: reusable TSL noise functions for smaller shaders.
- `assets/weather/cirrus_ice_trails.png`: upstream linear cirrus-opacity atlas.
- `assets/starmap_tycho_4k.jpg`: Eanpa's crisp 4096x2048 Tycho star and
  Milky Way panorama.
- `assets/moon_color_1k.jpg`: the Eanpa-distributed NASA CGI Moon Kit LROC
  color map. NASA source imagery is public domain.

Local integration changes to `sky_system.js` are intentionally small:

- expose the engine as an ES module using the application's single Three.js
  runtime;
- accept an observer latitude and local sidereal angle;
- precess Eanpa's J2000 Tycho panorama into epoch 1550 while sampling it in
  equatorial space;
- combine that dense field with the application's authoritative naked-eye
  catalogue using Eanpa's contrast-squared response;
- retain the catalogue alpha channel for optional constellation guides; and
- expose sun/moon direction setters so the authoritative seasonal day/night
  presentation drives Eanpa instead of its demonstration clock; the moon setter
  retains a valid tangent basis at the poles and upstream cloud-key refresh;
- leave Eanpa's optional MRT node unset for the application's forward-only
  Three r185 render path, avoiding an empty WebGPU output structure.

The game still builds its own precessed 1550 catalogue from real star
coordinates. It supplies authoritative bright-star color, magnitude, and
constellation guides; the Tycho panorama supplies Eanpa's sharper faint-star
and Milky Way detail. Both layers use the same local time, month, latitude, and
sidereal transform at Gorski Kotar.

## Updating and verification

`integration.patch` records every local engine change against the pinned commit.
The three helper modules, cirrus atlas, licence, and upstream documentation are
unmodified. Rebase this patch when updating; check semantic overlap even when
Git merges without a conflict (upstream added its own moon setter in 0.2.1).
The existing Tycho and moon assets remain intact.

The game continues to own its seasonal lighting, fog, weather, precipitation,
surface materials, render passes, and historical celestial catalogue through
`src/sky/SkyCloudMesh.ts`. Upstream demo rain, puddles, postprocessing, and patched
Three.js runtime are not imported. The new optional cloud-shadow receiver API is
available in the vendor engine, but the game does not call `applyToLights`,
`wrapCloudShadows`, or `prepareCloudShadows`; enabling world cloud shadows is a
separate rendering integration. See `UPSTREAM_INTEGRATION.md` for that API.

Run `npm run test:eanpa-sky-integration`, `npm run test:eanpa-sky-browser`,
`npm run test:celestial-sky`, `npm run test:day-night`, and `npm run build`.
The browser regression uses native WebGPU and writes captures under
`artifacts/eanpa-sky/`. It checks day/night output, paused-frame stability,
seasonal star rotation, constellation guides, a zenith moon, and opaque depth.

Validation on 2026-09-11: production build, integration regression, native
WebGPU browser regression (NVIDIA Lovelace), day/night presentation, and
precipitation visuals passed. Seven browser captures reported no GPU errors;
the paused frame was pixel-identical, guide visibility changed 6,311 pixels,
and seasonal rotation changed 175,188 pixels.

The two pre-existing failures at game commit
`adebb282df90627f3ec63c8e89f076cf1cf14fe9` were fixed in the follow-up:

- The application projects sky/cloud dome vertices to far depth, keeping them
  behind the entire terrain horizon and preventing altitude-dependent clipping.
  This is an application hook in `src/sky/skyDomeDepth.ts`; the vendor patch is
  unchanged. The legacy fallback uses the equivalent clip-space depth.
- Camera far distance now follows the full three-dimensional live orbit and
  map dimensions: 2,600 / 2,824 / 3,819 metres for small / medium / large maps.
  The camera controller and visibility bounds share the actual outer zoom stop.
- The startup test executes the production warmup methods, checking texture
  upload, one scene compile in the live pass state, asynchronous completion,
  hidden-object preservation, and cleanup on failure.
- The suite also exposed an August bundle-size ceiling already exceeded by
  the original revision. Its source was rebuilt with the installed toolchain:
  entry 1,270,751 bytes / 371,768 gzip; static closure 3,665,550 / 1,053,526 gzip.
  The current baseline allows 1% growth for each metric. Reproduce it with
  `node scripts/measureStartupBundle.mjs --ref=adebb282df90627f3ec63c8e89f076cf1cf14fe9`.

Both `test:celestial-sky` and `test:startup-chunking` now pass, as do camera
controls, startup loading, terrain horizon, Eanpa integration and production
build checks. `test:sky-depth-browser` isolates depth with an opaque cyan sky
and a magenta receiver near the far plane, across all three map sizes, three
heights and three pitches. All 54 views across native WebGPU and legacy WebGL
passed with zero receiver overwrites or sky holes. Select the legacy fallback
with `SKY_DEPTH_BACKEND=webgl`. Normal sky appearance and the historical
catalogue remain covered separately by `test:eanpa-sky-browser`.

Local comparison evidence is in `artifacts/eanpa-update/`,
`artifacts/eanpa-sky/`, and `artifacts/sky-depth-*` (ignored by Git).
