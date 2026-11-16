import { colors, fonts, layout, typeScale } from '@oregano/ui';

/** Writes the brand tokens onto :root so styles.css never repeats a hex value or size. */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--font-heading': `'${fonts.heading}', serif`,
    '--font-body': `'${fonts.body}', system-ui, sans-serif`,
    '--size-title': `${typeScale.title.size}px`,
    '--size-body': `${typeScale.body.size}px`,
    '--size-caption': `${typeScale.caption.size}px`,
    '--weight-strong': typeScale.bodyStrong.weight,
    '--margin': `${layout.screenMargin}px`,
    '--radius-button': `${layout.buttonRadius}px`,
    '--radius-card': `${layout.cardRadiusMin}px`,
    '--tap': `${layout.minTapTarget}px`,
  };
  for (const [name, value] of Object.entries(colors)) {
    vars[`--color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
