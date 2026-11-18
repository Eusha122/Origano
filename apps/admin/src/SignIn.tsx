import { ApiError, useApi, useMutation } from '@oregano/app-core';
import { type MessageKey, t } from '@oregano/i18n';
import { type FormEvent, useState } from 'react';

function errorKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return 'error.generic';
  if (error.status === 0) return 'status.offline';
  switch (error.code) {
    case 'invalid_phone':
      return 'auth.invalidPhone';
    case 'otp_invalid':
    case 'otp_expired':
    case 'otp_attempts_exceeded':
      return 'auth.wrongCode';
    default:
      return 'error.generic';
  }
}

/** Phone number, then the 6-digit code. The team signs in the same way as the apps. */
export function SignIn(props: { signIn: (phone: string, code: string) => Promise<void> }) {
  const api = useApi();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);

  const sendCode = useMutation({ mutationFn: () => api.requestOtp(phone), onSuccess: () => setSent(true) });
  const verify = useMutation({ mutationFn: () => props.signIn(phone, code) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sent) verify.mutate();
    else sendCode.mutate();
  };

  return (
    <form className="card sign-in" onSubmit={submit}>
      <h1>{t('en', 'auth.title')}</h1>
      <label>
        {t('en', 'auth.phoneLabel')}
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {sendCode.isError ? <p role="alert">{t('en', errorKey(sendCode.error))}</p> : null}
      <button type="button" disabled={sendCode.isPending} onClick={() => sendCode.mutate()}>
        {t('en', 'auth.sendCode')}
      </button>
      {sent ? (
        <>
          <p className="muted">{t('en', 'auth.codeSent', { phone })}</p>
          <label>
            {t('en', 'auth.codeLabel')}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {verify.isError ? <p role="alert">{t('en', errorKey(verify.error))}</p> : null}
          <button type="submit" disabled={verify.isPending}>
            {t('en', 'auth.signIn')}
          </button>
        </>
      ) : null}
    </form>
  );
}
