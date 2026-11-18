import { t } from '@oregano/i18n';
import { useState } from 'react';

/**
 * A button that asks "Are you sure?" before it does anything. Every decision goes through this, so nothing
 * that is recorded in the audit log happens on a single stray click.
 */
export function ConfirmButton(props: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className={props.secondary ? 'secondary' : ''}
        disabled={props.disabled || props.busy}
        onClick={() => setAsking(true)}
      >
        {props.label}
      </button>
    );
  }
  return (
    <div className="confirm" role="alertdialog" aria-label={props.label}>
      <p>{t('en', 'admin.confirm')}</p>
      <div className="row">
        <button
          type="button"
          disabled={props.busy}
          onClick={() => {
            setAsking(false);
            props.onConfirm();
          }}
        >
          {t('en', 'admin.confirmYes')}
        </button>
        <button type="button" className="secondary" onClick={() => setAsking(false)}>
          {t('en', 'admin.cancel')}
        </button>
      </div>
    </div>
  );
}

/** The reason an applicant or team member will read: 10 to 500 characters. */
export function reasonProblem(reason: string): boolean {
  const length = reason.trim().length;
  return length < 10 || length > 500;
}
