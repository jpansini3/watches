import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="font-serif text-3xl">Watch not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">That piece is not on the list.</p>
      <Link href="/" className="mt-6 inline-block text-sm font-medium underline">
        Back to watches
      </Link>
    </div>
  );
}
