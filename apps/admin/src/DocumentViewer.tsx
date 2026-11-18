import { errorMessageKey, useApi } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { useEffect, useState } from 'react';

/**
 * Shows one identity document. The link is requested (and recorded in the audit log) when this opens, then the
 * picture is fetched with the ticket in a header and shown from a local object URL. The ticket never appears in
 * the page address, the history or the clipboard, and the object URL is revoked on close and when the link expires.
 */
export function DocumentViewer(props: { documentId: string; onClose: () => void }) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const revoke = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      if (!cancelled) setUrl(null);
    };
    (async () => {
      try {
        const link = await api.documentLink(props.documentId);
        const blob = await api.documentImage(link);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        // After the link's five minutes the picture goes away; opening it again makes a new, audited link.
        timer = setTimeout(revoke, Math.max(new Date(link.expiresAt).getTime() - Date.now(), 0));
      } catch (error) {
        if (!cancelled) setFailure(t('en', errorMessageKey(error)));
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, props.documentId]);

  return (
    <div className="viewer card">
      <p className="muted">{t('en', 'admin.documentNote')}</p>
      {failure ? (
        <p role="alert">{failure}</p>
      ) : url ? (
        <img src={url} alt="Identity document" className="document" />
      ) : (
        <p>{t('en', 'admin.documentLoading')}</p>
      )}
      <button type="button" className="secondary" onClick={props.onClose}>
        {t('en', 'admin.closeDocument')}
      </button>
    </div>
  );
}
