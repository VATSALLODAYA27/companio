/**
 * Phase 1 placeholder home screen. This intentionally does NOT yet
 * implement the login → activity → discovery flow — that's Phases 2-4.
 * Its only job right now is to prove the web app boots and can reach the
 * API's public health endpoint, as a scaffold sanity check.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-brand-700">
        Companio
      </h1>
      <p className="text-sm text-gray-600">
        Find someone to do something with — nearby, verified, right now.
      </p>
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 text-left text-xs text-gray-500 shadow-sm">
        <p className="font-medium text-gray-700">Scaffold status</p>
        <p className="mt-1">
          Phase 1 complete: project structure, database schema, and
          security model are in place. Login, activity selection, and
          nearby discovery arrive in the following phases.
        </p>
      </div>
    </main>
  );
}
