'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/auth-context';
import { Button, Spinner } from '../components/ui';

export default function HomePage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/discover');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-brand-700">Companio</h1>
      <p className="text-sm text-gray-600">
        Find a verified person nearby who wants to do the same activity, right now — and chat
        safely once you both say yes.
      </p>
      <div className="flex gap-3">
        <Link href="/login">
          <Button>Log in</Button>
        </Link>
        <Link href="/login?mode=register">
          <Button variant="secondary">Create account</Button>
        </Link>
      </div>
    </main>
  );
}
