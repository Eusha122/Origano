/** Brand tokens, copied exactly from the Oregano Product & Brand Book, sections 17 to 19. */
export const colors = {
  plum: '#3D1A33',
  champagne: '#EBC9A0',
  cream: '#F8EDE6',
  white: '#FFFFFF',
  coral: '#E8846B',
  mutedPlum: '#6B5A63',
  line: '#EEE6E9',
} as const;

export type ColorName = keyof typeof colors;

export const fonts = {
  heading: 'Fraunces',
  body: 'Plus Jakarta Sans',
  bangla: 'Hind Siliguri',
} as const;

export const typeScale = {
  display: { font: 'heading', size: 34, weight: '400' },
  title: { font: 'heading', size: 28, weight: '400' },
  sectionHeading: { font: 'body', size: 18, weight: '600' },
  body: { font: 'body', size: 15, weight: '400' },
  bodyStrong: { font: 'body', size: 15, weight: '600' },
  caption: { font: 'body', size: 13, weight: '400' },
  label: { font: 'body', size: 11, weight: '400' },
} as const;

export const layout = {
  screenMargin: 20,
  sectionGapMin: 32,
  sectionGapMax: 40,
  minTapTarget: 48,
  buttonRadius: 14,
  cardRadiusMin: 20,
  cardRadiusMax: 24,
  cartBarRadius: 20,
  iconStroke: 1.5,
} as const;

/** The only text-on-background combinations the book allows. Components must pick from this list. */
export const textPairs: ReadonlyArray<{ text: ColorName; background: ColorName }> = [
  { text: 'plum', background: 'white' },
  { text: 'plum', background: 'cream' },
  { text: 'mutedPlum', background: 'white' },
  { text: 'mutedPlum', background: 'cream' },
  { text: 'cream', background: 'plum' },
  { text: 'champagne', background: 'plum' },
];
