import { useApi, useMutation, useSession } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { Body, Button, Heading, Screen, TextField, useLocale } from '@oregano/ui-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { errorKey } from '../components';

/** Sign-in happens only at checkout, so signing in returns there. */
export default function SignIn() {
  const { locale } = useLocale();
  const api = useApi();
  const session = useSession();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);

  const sendCode = useMutation({
    mutationFn: () => api.requestOtp(phone),
    onSuccess: () => setSent(true),
  });
  const verify = useMutation({
    mutationFn: () => session.signIn(phone, code),
    onSuccess: () => router.replace('/checkout'),
  });

  const phoneError = sendCode.isError ? t(locale, errorKey(sendCode.error)) : null;
  const codeError = verify.isError ? t(locale, errorKey(verify.error)) : null;

  return (
    <Screen scroll>
      <Heading>{t(locale, 'auth.title')}</Heading>
      <TextField
        label={t(locale, 'auth.phoneLabel')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        error={phoneError}
      />
      <Button label={t(locale, 'auth.sendCode')} busy={sendCode.isPending} onPress={() => sendCode.mutate()} />
      {sent ? (
        <>
          <Body muted>{t(locale, 'auth.codeSent', { phone })}</Body>
          <TextField
            label={t(locale, 'auth.codeLabel')}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            error={codeError}
          />
          <Button label={t(locale, 'auth.signIn')} busy={verify.isPending} onPress={() => verify.mutate()} />
        </>
      ) : null}
    </Screen>
  );
}
