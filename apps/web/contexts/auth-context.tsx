'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, ApiError } from '../lib/api';
import { disconnectSocket } from '../lib/socket';
import type { SessionResponse } from '../lib/types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  refresh: () => Promise<void>;
  setAuthenticated: (userId: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const session = await api.get<SessionResponse>('/auth/session');
      setUserId(session.userId);
      setStatus('authenticated');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUserId(null);
        setStatus('unauthenticated');
        return;
      }
      // A network/5xx hiccup shouldn't be treated as "logged out" —
      // leave status as-is so a transient blip doesn't bounce someone
      // to /login; the page that triggered this can retry.
      setStatus((prev) => (prev === 'loading' ? 'unauthenticated' : prev));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setAuthenticated = useCallback((id: string) => {
    setUserId(id);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      disconnectSocket();
      setUserId(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo(
    () => ({ status, userId, refresh, setAuthenticated, logout }),
    [status, userId, refresh, setAuthenticated, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
