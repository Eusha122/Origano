import { t } from '@oregano/i18n';
import { Button } from './Button';
import { useLocale } from './locale';

/** Switches between English and Bangla; its label is always the other language's name. */
export function LanguageButton() {
  const { locale, setLocale } = useLocale();
  return <Button label={t(locale, 'language.switchTo')} onPress={() => setLocale(locale === 'en' ? 'bn' : 'en')} />;
}
