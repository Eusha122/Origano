import { useRealtimeHints, useSession } from '@oregano/app-core';
import { t } from '@oregano/i18n';
import { useState } from 'react';
import { Agencies, Restaurants, Riders } from './Accounts';
import { Applications } from './Applications';
import { allowedTabs, Nav, type TabId } from './Nav';
import { Orders } from './Orders';
import { SignIn } from './SignIn';
import { Team } from './Team';
import { Zones } from './Zones';

export function App() {
  const session = useSession();
  useRealtimeHints();
  const [chosen, setChosen] = useState<TabId | null>(null);

  const tabs = session.me ? allowedTabs(session.me.teamRoles) : [];
  // A tab the person may not open is never shown; if the chosen one is gone, the first allowed tab takes over.
  const current: TabId | null = tabs.find((tab) => tab.id === chosen)?.id ?? tabs[0]?.id ?? null;

  return (
    <>
      <header className="bar">
        <img src="/oregano-wordmark-plum.svg" alt="Oregano" className="logo" />
        {session.isSignedIn ? (
          <button type="button" className="secondary" onClick={() => void session.signOut()}>
            Log out
          </button>
        ) : null}
      </header>
      <main>
        {!session.isSignedIn ? (
          <SignIn signIn={session.signIn} />
        ) : session.isLoading ? (
          <p>Loading…</p>
        ) : session.me && !session.me.roles.includes('admin') ? (
          <p>This dashboard is for the Oregano team.</p>
        ) : session.me && current ? (
          <>
            <Nav tabs={tabs} current={current} onChange={setChosen} />
            {current === 'orders' ? <Orders /> : null}
            {current === 'applications' ? <Applications /> : null}
            {current === 'riders' ? <Riders /> : null}
            {current === 'restaurants' ? <Restaurants /> : null}
            {current === 'agencies' ? <Agencies /> : null}
            {current === 'zones' ? <Zones /> : null}
            {current === 'team' ? <Team /> : null}
          </>
        ) : session.me ? (
          <p>{t('en', 'admin.notYours')}</p>
        ) : (
          <p role="alert">Could not reach the server. Retrying…</p>
        )}
      </main>
    </>
  );
}
