# Measurements

Numbers measured on the real build, used as baselines for the budgets in the blueprint.

## Customer web export

Measured 16 November 2026 with `pnpm --filter @oregano/customer build:web` (Expo SDK 58, React Native 0.88, React 19.3). The app at this point is one screen.

| What                                | Size                          |
| ----------------------------------- | ----------------------------- |
| All JavaScript, gzipped             | 316 KB (1.18 MB uncompressed) |
| Largest file: entry bundle, gzipped | 289 KB                        |
| Font files (5 TTF, uncompressed)    | 761 KB                        |

**Against the slow-3G budget (blueprint section 10):** at roughly 400 kbit/s, 316 KB of JavaScript alone takes about 6.5 seconds to download, before fonts and before any content. A one-screen app already misses the 5-second target. Plan 05 must decide, with a real throttled measurement, between trimming the Expo web bundle (route-level splitting, font subsetting, WOFF2) and the fallback the blueprint names: a lighter web front end for the public customer pages over the same API and packages.

Fix already applied: fonts are imported per weight. Importing each font package from its root had pulled every weight and italic into the export.
