import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 md:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-192.png" alt="" className="h-9 w-9" />
            </span>
            <span className="min-w-0">
              <span className="block font-serif text-lg leading-none">Watches</span>
              <span className="mt-0.5 hidden text-xs text-muted-foreground sm:block">Want list</span>
            </span>
          </Link>
        </div>
      </header>
      <main className="mx-auto min-w-0 w-full max-w-6xl flex-1 overflow-x-hidden px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
