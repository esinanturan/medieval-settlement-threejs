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

Two broader checks already fail at game commit
`adebb282df90627f3ec63c8e89f076cf1cf14fe9`:
`test:celestial-sky` rejects the medium-world extent against the existing sky
radius, and `test:startup-chunking` expects an older startup compilation source
pattern. Both failures were reproduced using the original committed source.
The remaining celestial assertions passed in a scratch copy with only that
world-extent assertion omitted; the committed tests and world settings were
not changed. Local comparison evidence is in `artifacts/eanpa-update/` and
`artifacts/eanpa-sky/` (ignored by Git).
