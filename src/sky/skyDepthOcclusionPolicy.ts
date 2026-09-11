/** Geometry used to rasterize sky directions; sky materials project it to far depth. */
export const SKY_DOME_RADIUS = 2_500;

/** Conservative authored vertical envelope for terrain, structures, vegetation, and orbit height. */
export const WORLD_OPAQUE_VERTICAL_ENVELOPE = 384;

export function maximumOpaqueWorldDistanceFromCamera(options: {
  terrainSize: number;
  playableSize: number;
  maxOrbitDistance: number;
  verticalEnvelope?: number;
}): number {
  const terrainHalf = Math.max(0, options.terrainSize) * 0.5;
  const playableHalf = Math.max(0, options.playableSize) * 0.5;
  // The camera target is clamped to the playable square. Adding the complete
  // orbit distance (rather than its horizontal projection) is conservative for
  // every pitch/yaw and every opposite terrain corner.
  const horizontalReach = Math.SQRT2 * (terrainHalf + playableHalf);
  return Math.hypot(
    horizontalReach,
    Math.max(0, options.verticalEnvelope ?? WORLD_OPAQUE_VERTICAL_ENVELOPE),
  ) + Math.max(0, options.maxOrbitDistance);
}

/** Preserve the small-world horizon while fitting larger maps from every pan/zoom position. */
export function computeWorldCameraFarPlane(
  options: Parameters<typeof maximumOpaqueWorldDistanceFromCamera>[0],
): number {
  return Math.max(2_600, Math.ceil(maximumOpaqueWorldDistanceFromCamera(options) * 1.05));
}
