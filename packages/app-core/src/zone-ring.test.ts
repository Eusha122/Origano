import { describe, expect, it } from 'vitest';
import { addVertex, fromPolygon, moveVertex, toPolygon, undoVertex } from './zone-ring';

describe('zone ring editing', () => {
  it('adds a vertex rounded to 6 decimals, without changing the old list', () => {
    const before: [number, number][] = [[88.1, 24.1]];
    const after = addVertex(before, [88.12345678, 24.5]);
    expect(after).toEqual([
      [88.1, 24.1],
      [88.123457, 24.5],
    ]);
    expect(before).toHaveLength(1);
  });

  it('moves one vertex and leaves the rest', () => {
    const ring: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    expect(moveVertex(ring, 1, [9, 9])).toEqual([
      [1, 1],
      [9, 9],
      [3, 3],
    ]);
    expect(moveVertex(ring, 7, [9, 9])).toEqual(ring);
  });

  it('undoes the last vertex, and an empty list stays empty', () => {
    expect(
      undoVertex([
        [1, 1],
        [2, 2],
      ]),
    ).toEqual([[1, 1]]);
    expect(undoVertex([])).toEqual([]);
  });

  it('needs three vertices, and closes the ring by repeating the first', () => {
    expect(
      toPolygon([
        [1, 1],
        [2, 2],
      ]),
    ).toBeNull();
    expect(
      toPolygon([
        [1, 1],
        [2, 1],
        [2, 2],
      ]),
    ).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 1],
        ],
      ],
    });
  });

  it('reads a saved polygon back without its closing point', () => {
    const polygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 1],
        ],
      ] as [number, number][][],
    };
    expect(fromPolygon(polygon)).toEqual([
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
    expect(toPolygon(fromPolygon(polygon))).toEqual(polygon);
  });
});
