import { cameraProjectionMatrix, Fn, float, modelViewMatrix, positionLocal, vec4 } from 'three/tsl';

/**
 * Sky is a background, even where the outer terrain extends past its mesh.
 * Set clip-space depth at the vertex stage: ordinary opaque depth still
 * rejects cloud fragments early, and the dome cannot cross the far plane as
 * the camera gains altitude. XY/W and the authored world-space rays stay intact.
 */
export const skyDomeVertex = Fn((builder) => {
  const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1));
  return vec4(clip.xy, builder.renderer.reversedDepthBuffer ? float(0) : clip.w, clip.w);
})();
