import type { Locale } from '@oregano/i18n';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

type LocaleState = { locale: Locale; setLocale: (locale: Locale) => void };

const LocaleContext = createContext<LocaleState | null>(null);

/** Holds the chosen language in memory. Persistence arrives with the profile screen in Plan 05. */
export function LocaleProvider(props: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('en');
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext);
  if (!state) throw new Error('useLocale must be used inside LocaleProvider');
  return state;
}
