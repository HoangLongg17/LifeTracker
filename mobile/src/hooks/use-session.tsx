import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';

import { auth } from '@/config/firebase';
import { AccountRequestError, loadAccount } from '@/services/session';
import { errorCode } from '@/utils/auth';

type Session =
  | { status: 'restoring' }
  | { status: 'guest'; message?: string }
  | { status: 'checking'; user: User }
  | { status: 'unavailable'; user: User; message: string }
  | { status: 'active'; user: User; displayName: string | null };

function denialMessage(error: unknown) {
  const code = errorCode(error);
  if (code === 'ACCOUNT_DISABLED' || code === 'auth/user-disabled') return 'Tài khoản này đã bị vô hiệu hóa.';
  if (code === 'ACCOUNT_DELETING') return 'Tài khoản đang được xóa và không thể truy cập.';
  if (error instanceof AccountRequestError && (error.status === 401 || error.status === 403)
      || ['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-not-found'].includes(code)) {
    return 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.';
  }
}

const SessionContext = createContext<{
  session: Session;
  initialized: boolean;
  retry: () => void;
  updateDisplayName: (displayName: string | null) => void;
} | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session>({ status: 'restoring' });
  const [initialized, setInitialized] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const notice = useRef<string | undefined>(undefined);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const updateDisplayName = useCallback((displayName: string | null) => setSession(current => current.status === 'active'
    ? { ...current, displayName }
    : current), []);

  useEffect(() => {
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const request = ++generation;
      if (!user) {
        setSession({ status: 'guest', message: notice.current });
        notice.current = undefined;
        setInitialized(true);
        return;
      }

      const isCurrent = () => generation === request && auth.currentUser === user;
      setSession({ status: 'checking', user });
      try {
        const account = await loadAccount(user);
        if (isCurrent()) setSession({ status: 'active', user, displayName: account.displayName });
      } catch (error) {
        if (!isCurrent()) return;
        const denied = denialMessage(error);
        if (denied) {
          notice.current = denied;
          try {
            await signOut(auth);
            return;
          } catch {
            // Stay outside the protected screens if local persistence could not be cleared.
          }
        }
        if (isCurrent()) {
          setSession({ status: 'unavailable', user, message: denied ?? 'Chưa thể kết nối với máy chủ Life Tracker. Kiểm tra kết nối rồi thử lại.' });
        }
      } finally {
        if (isCurrent()) setInitialized(true);
      }
    });
    return () => { generation++; unsubscribe(); };
  }, [attempt]);

  return (
    <SessionContext.Provider value={{
      session,
      initialized,
      retry,
      updateDisplayName,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider is missing');
  return value;
}
