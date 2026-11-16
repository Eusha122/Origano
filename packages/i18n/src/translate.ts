import { bn } from './bn';
import { en, type MessageKey } from './en';

export type Locale = 'en' | 'bn';

export const messages: Record<Locale, Record<MessageKey, string>> = { en, bn };

const PLACEHOLDER = /\{(\w+)\}/g;

/** Returns the message for a key, filling every {name} placeholder. Throws if a placeholder has no value. */
export function t(locale: Locale, key: MessageKey, params: Record<string, string | number> = {}): string {
  return messages[locale][key].replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing parameter "${name}" for message "${key}"`);
    }
    return String(value);
  });
}
