"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Plus, X } from "lucide-react";
import { PhotoField } from "@/components/photo-field";
import { WatchPhoto } from "@/components/watch-photo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { fetchJson } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import type { WatchSummary } from "@/lib/queries";
import type { WatchLookupResult } from "@/lib/watch-lookup";
import { cn } from "@/lib/utils";

const VIEW_KEY = "watches-view";
const COMPLICATIONS = [
  "Date",
  "Day-date",
  "Chronograph",
  "GMT",
  "Moon phase",
  "Power reserve",
  "Annual calendar",
  "Perpetual calendar",
  "World time",
  "Tourbillon",
  "Small seconds",
  "Alarm",
];

export function WatchCollection({ initialWatches }: { initialWatches: WatchSummary[] }) {
  const router = useRouter();
  const [watches, setWatches] = useState(initialWatches);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setWatches(initialWatches);
  }, [initialWatches]);

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "list" || stored === "grid") setView(stored);
  }, []);

  function chooseView(next: "grid" | "list") {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Watches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pieces to buy, with the new price and the cheapest listing on Chrono24.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5" role="group" aria-label="Layout">
            <Button
              type="button"
              size="icon"
              variant={view === "grid" ? "default" : "ghost"}
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => chooseView("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={view === "list" ? "default" : "ghost"}
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => chooseView("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add watch
          </Button>
        </div>
      </div>

      {watches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="font-serif text-2xl">Nothing on the list yet</p>
          <p className="mt-2 text-sm text-muted-foreground">Add a watch to start tracking prices.</p>
          <Button type="button" className="mt-5" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add watch
          </Button>
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {watches.map((watch) => (
            <li key={watch.id}>
              <WatchCard watch={watch} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {watches.map((watch) => (
            <li key={watch.id}>
              <WatchRow watch={watch} />
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddWatchDialog
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function WatchCard({ watch }: { watch: WatchSummary }) {
  return (
    <Link
      href={`/watches/${watch.id}`}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-brass"
    >
      <WatchPhoto src={watch.imageUrl} alt="" className="aspect-square w-full" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-brass">{watch.manufacturer}</p>
          <h2 className="mt-1 font-serif text-xl leading-tight">{watch.model}</h2>
          {watch.referenceNumber ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">Ref. {watch.referenceNumber}</p>
          ) : null}
        </div>
        <PricePair watch={watch} />
      </div>
    </Link>
  );
}

function WatchRow({ watch }: { watch: WatchSummary }) {
  return (
    <Link href={`/watches/${watch.id}`} className="flex items-center gap-4 px-3 py-3 hover:bg-accent/70">
      <WatchPhoto src={watch.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-[0.14em] text-brass">{watch.manufacturer}</p>
        <h2 className="truncate font-serif text-lg leading-tight">{watch.model}</h2>
        {watch.referenceNumber ? (
          <p className="truncate text-sm text-muted-foreground">Ref. {watch.referenceNumber}</p>
        ) : null}
        <PricePair watch={watch} className="mt-2 sm:hidden" />
      </div>
      <PricePair watch={watch} className="hidden shrink-0 text-right sm:grid" />
    </Link>
  );
}

function PricePair({ watch, className }: { watch: WatchSummary; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-3 text-sm", className)}>
      <div>
        <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">New</dt>
        <dd className="tabular font-medium">{formatMoney(watch.retailPriceCents)}</dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Chrono24</dt>
        <dd className="tabular font-medium">{formatMoney(watch.chrono24PriceCents)}</dd>
      </div>
    </dl>
  );
}

function AddWatchDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const titleId = useId();
  const [pageUrl, setPageUrl] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [retailPrice, setRetailPrice] = useState("");
  const [chrono24Price, setChrono24Price] = useState("");
  const [chrono24Url, setChrono24Url] = useState("");
  const [complications, setComplications] = useState("");
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [readingPage, setReadingPage] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function applyLookup(result: WatchLookupResult) {
    setManufacturer(result.manufacturer);
    setModel(result.model);
    setReferenceNumber(result.referenceNumber ?? "");
    setImageUrl(result.imageUrl ?? "");
    setRetailPrice(result.retailPrice ?? "");
    setChrono24Price(result.chrono24Price ?? "");
    setChrono24Url(result.chrono24Url);
    setComplications(result.complications);
    setNote(result.note);
  }

  async function onLookupPage() {
    setReadingPage(true);
    setError(null);
    setNote(null);
    try {
      const params = new URLSearchParams({ url: pageUrl.trim() });
      applyLookup(await fetchJson<WatchLookupResult>(`/api/watches/lookup?${params}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that page");
    } finally {
      setReadingPage(false);
    }
  }

  async function onLookup() {
    setLookingUp(true);
    setError(null);
    setNote(null);
    try {
      const params = new URLSearchParams({ manufacturer, model });
      applyLookup(await fetchJson<WatchLookupResult>(`/api/watches/lookup?${params}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not look up that watch");
    } finally {
      setLookingUp(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await fetchJson("/api/watches", {
        method: "POST",
        body: JSON.stringify({
          manufacturer,
          model,
          referenceNumber: referenceNumber || null,
          imageUrl: imageUrl || null,
          pageUrl: pageUrl || null,
          retailPrice: retailPrice || null,
          chrono24Price: chrono24Price || null,
          chrono24Url: chrono24Url || null,
          complications,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add watch");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-serif text-2xl">
            Add a watch
          </h2>
          <Button type="button" size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field
            label="Manufacturer page"
            value={pageUrl}
            onChange={setPageUrl}
            placeholder="https://nomos-glashuette.com/..."
            type="url"
            autoFocus
          />
          <div className="grid gap-2">
            <Button type="button" variant="outline" disabled={readingPage || lookingUp || !pageUrl.trim()} onClick={onLookupPage}>
              {readingPage ? "Reading page…" : "Fill from this page"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Paste a product page from any manufacturer. The name, reference number, photo, and price are read from that page.
            </p>
          </div>
          <Field label="Manufacturer" value={manufacturer} onChange={setManufacturer} required />
          <Field label="Model" value={model} onChange={setModel} required />
          <Field label="Reference number" value={referenceNumber} onChange={setReferenceNumber} placeholder="126610LN" />
          <Button
            type="button"
            variant="outline"
            disabled={lookingUp || readingPage || !manufacturer.trim() || !model.trim()}
            onClick={onLookup}
          >
            {lookingUp ? "Looking up…" : "Look up details"}
          </Button>
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
          <PhotoField id="watch-photo" value={imageUrl} onChange={setImageUrl} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Price new" value={retailPrice} onChange={setRetailPrice} placeholder="12500" inputMode="decimal" />
            <Field
              label="Cheapest on Chrono24"
              value={chrono24Price}
              onChange={setChrono24Price}
              placeholder="10950"
              inputMode="decimal"
            />
          </div>
          <Field label="Chrono24 link" value={chrono24Url} onChange={setChrono24Url} placeholder="https://www.chrono24.com/..." />
          <div className="grid gap-2">
            <Label htmlFor="complications">Complications</Label>
            <Input
              id="complications"
              list="complication-suggestions"
              value={complications}
              placeholder="Date, GMT"
              onChange={(event) => setComplications(event.target.value)}
            />
            <datalist id="complication-suggestions">
              {COMPLICATIONS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">Separate features with commas.</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save watch"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  placeholder,
  inputMode,
  autoFocus,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoFocus?: boolean;
  type?: React.HTMLInputTypeAttribute;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        spellCheck={type === "url" ? false : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
