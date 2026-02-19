/**
 * GeoJSON helpers for heat route – centroid from Polygon/MultiPolygon.
 */

/**
 * Get exterior ring from GeoJSON Polygon or MultiPolygon.
 * @param {import('geojson').Geometry} geometry
 * @returns {[number, number][] | null} Ring as [lng, lat][]
 */
function getPolygonRing(geometry) {
  if (geometry == null || typeof geometry !== "object") return null;
  if (geometry.type === "Polygon" && geometry.coordinates?.[0]) {
    return geometry.coordinates[0];
  }
  if (geometry.type === "MultiPolygon" && geometry.coordinates?.length) {
    return geometry.coordinates[0][0];
  }
  return null;
}

/**
 * Centroid of a ring (average of vertices). GeoJSON ring is [lng, lat][].
 * @param {[number, number][]} ring
 * @returns {[number, number]} [lng, lat]
 */
function ringCentroid(ring) {
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng, lat] = ring[i];
    sumLng += lng;
    sumLat += lat;
    n += 1;
  }
  return n ? [sumLng / n, sumLat / n] : [0, 0];
}

/**
 * Get [lng, lat] centroid for a GeoJSON feature (Polygon or MultiPolygon).
 * @param {import('geojson').Feature} feature
 * @returns {[number, number] | null} [lng, lat] or null
 */
export function getFeatureCentroid(feature) {
  const ring = getPolygonRing(feature?.geometry);
  if (!ring || ring.length < 3) return null;
  return ringCentroid(ring);
}

/**
 * Ray-casting point-in-polygon. Ring is [lng, lat][] (GeoJSON order, closed).
 * @param {[number, number][]} ring
 * @param {number} lng
 * @param {number} lat
 * @returns {boolean}
 */
function pointInRing(ring, lng, lat) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  const n = ring.length - 1; // closed: last === first
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * All exterior rings from a Polygon or MultiPolygon (for point-in-geometry).
 * @param {import('geojson').Geometry} geometry
 * @returns {[number, number][][]}
 */
function getExteriorRings(geometry) {
  if (geometry == null || typeof geometry !== "object") return [];
  if (geometry.type === "Polygon" && geometry.coordinates?.[0]) {
    return [geometry.coordinates[0]];
  }
  if (geometry.type === "MultiPolygon" && geometry.coordinates?.length) {
    return geometry.coordinates.map((poly) => poly[0]).filter(Boolean);
  }
  return [];
}

/**
 * True if point (lng, lat) is inside the geometry (Polygon or MultiPolygon).
 * @param {import('geojson').Geometry} geometry
 * @param {number} lng
 * @param {number} lat
 * @returns {boolean}
 */
function pointInGeometry(geometry, lng, lat) {
  const rings = getExteriorRings(geometry);
  return rings.some((ring) => pointInRing(ring, lng, lat));
}
