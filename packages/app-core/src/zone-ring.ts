import type { GeoPolygon } from '@oregano/contracts';

/** A corner of a zone outline: [longitude, latitude]. */
export type LngLat = [number, number];

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export const addVertex = (vertices: readonly LngLat[], point: LngLat): LngLat[] => [
  ...vertices,
  [round6(point[0]), round6(point[1])],
];

export const moveVertex = (vertices: readonly LngLat[], index: number, point: LngLat): LngLat[] =>
  vertices.map((v, i) => (i === index ? ([round6(point[0]), round6(point[1])] as LngLat) : v));

export const undoVertex = (vertices: readonly LngLat[]): LngLat[] => vertices.slice(0, -1);

/** The corners as a closed GeoJSON polygon, or null while there are fewer than three. */
export function toPolygon(vertices: readonly LngLat[]): GeoPolygon | null {
  const first = vertices[0];
  if (!first || vertices.length < 3) return null;
  return { type: 'Polygon', coordinates: [[...vertices, first]] };
}

/** A saved polygon's corners, without the repeated first point. */
export function fromPolygon(polygon: GeoPolygon): LngLat[] {
  return (polygon.coordinates[0] ?? []).slice(0, -1);
}
