import { cn } from "@/lib/utils";

export function WatchPhoto({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div
        className={cn("flex items-center justify-center bg-accent text-brass", className)}
        aria-hidden
      >
        <WatchMark className="h-10 w-10" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={cn("bg-accent object-contain", className)} />
  );
}

export function WatchMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden>
      <circle cx="32" cy="34" r="16" stroke="currentColor" strokeWidth="2.5" />
      <path d="M26 18.5 28.2 8h7.6L38 18.5M26 49.5 28.2 60h7.6L38 49.5" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M32 34V25.5M32 34l6 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
