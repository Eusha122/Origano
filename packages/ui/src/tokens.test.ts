import { describe, expect, it } from 'vitest';
import { colors, contrastRatio, layout, textPairs, typeScale } from './index';

describe('brand tokens', () => {
  it('match the palette in the brand book exactly', () => {
    expect(colors).toEqual({
      plum: '#3D1A33',
      champagne: '#EBC9A0',
      cream: '#F8EDE6',
      white: '#FFFFFF',
      coral: '#E8846B',
      mutedPlum: '#6B5A63',
      line: '#EEE6E9',
    });
  });

  it('match the type scale and layout rules in the brand book', () => {
    expect(typeScale.display.size).toBe(34);
    expect(typeScale.title.size).toBe(28);
    expect(typeScale.body.size).toBe(15);
    expect(typeScale.caption.size).toBe(13);
    expect(layout.minTapTarget).toBe(48);
    expect(layout.screenMargin).toBe(20);
    expect(layout.buttonRadius).toBe(14);
  });

  it('computes contrast by the WCAG formula', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('gives every allowed text pair at least 4.5:1 contrast', () => {
    expect(textPairs).toHaveLength(6);
    for (const pair of textPairs) {
      const ratio = contrastRatio(colors[pair.text], colors[pair.background]);
      expect(ratio, `${pair.text} on ${pair.background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('never allows the combinations the book forbids', () => {
    const forbidden = [
      ['white', 'cream'],
      ['champagne', 'cream'],
      ['coral', 'white'],
      ['coral', 'cream'],
      ['coral', 'plum'],
    ];
    for (const [text, background] of forbidden) {
      expect(textPairs.some((p) => p.text === text && p.background === background)).toBe(false);
    }
  });
});
