'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/auth-context';
import { Alert, Button, Card, Input, Label } from '../../components/ui';

type Mode = 'login' | 'register';

function LoginForm() {
  const searchParams = useSearchParams();
  const initialMode: Mode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { refresh } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'register') {
        await api.post('/auth/register', { email, password, firstName });
      } else {
        await api.post('/auth/login', { email, password });
      }
      await refresh();
      router.replace(mode === 'register' ? '/profile' : '/discover');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-brand-700">Companio</h1>
        <p className="mt-1 text-sm text-gray-500">
          {mode === 'login' ? 'Welcome back.' : 'Create your account.'}
        </p>
      </div>

      <Card>
        <div className="mb-4 flex rounded-lg bg-gray-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-md py-1.5 font-medium ${
              mode === 'login' ? 'bg-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 rounded-md py-1.5 font-medium ${
              mode === 'register' ? 'bg-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === 'register' && (
            <div>
              <Label>First name</Label>
              <Input
                required
                maxLength={60}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex"
              />
            </div>
          )}
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              required
              minLength={mode === 'register' ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 10 characters, 1 number' : ''}
            />
          </div>

          {error && <Alert>{error}</Alert>}

          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </Button>
        </form>
      </Card>

      <p className="text-center text-xs text-gray-400">
        No payments, no ads, no exact locations shared. Just people, nearby, doing the same thing.
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
