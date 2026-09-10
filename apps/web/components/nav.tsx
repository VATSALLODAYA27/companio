'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../contexts/auth-context';
import { Button } from './ui';

const LINKS = [
  { href: '/discover', label: 'Discover' },
  { href: '/map', label: 'Map' },
  { href: '/connections', label: 'Connections' },
  { href: '/profile', label: 'Profile' },
  { href: '/safety', label: 'Safety' },
];

export function Nav() {
  const { status, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (status !== 'authenticated') {
    return null;
  }

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-2.5">
        <Link href="/discover" className="mr-2 shrink-0 text-lg font-semibold text-brand-700">
          Companio
        </Link>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
              pathname?.startsWith(link.href)
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {link.label}
          </Link>
        ))}
        <Button variant="ghost" className="ml-auto shrink-0" onClick={handleLogout}>
          Log out
        </Button>
      </nav>
    </header>
  );
}
