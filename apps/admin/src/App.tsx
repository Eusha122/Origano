import { useRealtimeHints, useSession } from '@oregano/app-core';
import { Orders } from './Orders';
import { SignIn } from './SignIn';

export function App() {
  const session = useSession();
  useRealtimeHints();

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
        ) : session.me ? (
          <Orders />
        ) : (
          <p role="alert">Could not reach the server. Retrying…</p>
        )}
      </main>
    </>
  );
}
