"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { PhotoField } from "@/components/photo-field";
import { PriceChart } from "@/components/price-chart";
import { WatchPhoto } from "@/components/watch-photo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { confirmDelete, fetchJson } from "@/lib/client";
import { centsToDollarsInput, formatMoney, todayIso, type PriceSource } from "@/lib/money";
import type { WatchDetail } from "@/lib/queries";

const SUGGESTIONS = [
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

export function WatchDetailView({ initialWatch }: { initialWatch: WatchDetail }) {
  const router = useRouter();
  const [watch, setWatch] = useState(initialWatch);
  const [manufacturer, setManufacturer] = useState(initialWatch.manufacturer);
  const [model, setModel] = useState(initialWatch.model);
  const [referenceNumber, setReferenceNumber] = useState(initialWatch.referenceNumber ?? "");
  const [imageUrl, setImageUrl] = useState(initialWatch.imageUrl ?? "");
  const [pageUrl, setPageUrl] = useState(initialWatch.pageUrl ?? "");
  const [retailPrice, setRetailPrice] = useState(centsToDollarsInput(initialWatch.retailPriceCents));
  const [chrono24Price, setChrono24Price] = useState(centsToDollarsInput(initialWatch.chrono24PriceCents));
  const [chrono24Url, setChrono24Url] = useState(initialWatch.chrono24Url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(next: WatchDetail) {
    setWatch(next);
    setManufacturer(next.manufacturer);
    setModel(next.model);
    setReferenceNumber(next.referenceNumber ?? "");
    setImageUrl(next.imageUrl ?? "");
    setPageUrl(next.pageUrl ?? "");
    setRetailPrice(centsToDollarsInput(next.retailPriceCents));
    setChrono24Price(centsToDollarsInput(next.chrono24PriceCents));
    setChrono24Url(next.chrono24Url ?? "");
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await fetchJson<WatchDetail>(`/api/watches/${watch.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          manufacturer,
          model,
          referenceNumber: referenceNumber || null,
          imageUrl: imageUrl || null,
          pageUrl: pageUrl || null,
          retailPrice: retailPrice || null,
          chrono24Price: chrono24Price || null,
          chrono24Url: chrono24Url || null,
        }),
      });
      apply(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function removeWatch() {
    if (!confirmDelete(`${watch.manufacturer} ${watch.model}`)) return;
    await fetchJson(`/api/watches/${watch.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          All watches
        </Link>
        <div className="mt-3 flex flex-col gap-6 md:flex-row">
          <WatchPhoto
            src={watch.imageUrl}
            alt={`${watch.manufacturer} ${watch.model}`}
            className="aspect-square w-full rounded-lg border border-border md:w-80"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-brass">{watch.manufacturer}</p>
            <h1 className="mt-1 font-serif text-4xl tracking-tight">{watch.model}</h1>
            {watch.referenceNumber ? (
              <p className="mt-1 text-sm text-muted-foreground">Ref. {watch.referenceNumber}</p>
            ) : null}
            {watch.pageUrl ? (
              <p className="mt-3">
                <a href={watch.pageUrl} className="text-sm underline" target="_blank" rel="noreferrer">
                  Manufacturer page
                </a>
              </p>
            ) : null}
            <dl className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Price new</dt>
                <dd className="tabular mt-1 font-serif text-2xl">{formatMoney(watch.retailPriceCents)}</dd>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cheapest on Chrono24</dt>
                <dd className="tabular mt-1 font-serif text-2xl">{formatMoney(watch.chrono24PriceCents)}</dd>
                {watch.chrono24Url ? (
                  <dd className="mt-2">
                    <a href={watch.chrono24Url} className="text-sm underline" target="_blank" rel="noreferrer">
                      Open listing
                    </a>
                  </dd>
                ) : null}
              </div>
            </dl>
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 md:p-6">
        <h2 className="font-serif text-2xl">Price over time</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          New retail price and the cheapest Chrono24 price you have recorded.
        </p>
        <div className="mt-4">
          <PriceChart prices={watch.prices} />
        </div>
        <PriceForm watchId={watch.id} onSaved={apply} />
        {watch.prices.length > 0 ? (
          <ul className="mt-4 divide-y divide-border text-sm">
            {[...watch.prices].reverse().map((price) => (
              <PriceListItem key={price.id} price={price} onSaved={apply} />
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 md:p-6">
        <h2 className="font-serif text-2xl">Complications</h2>
        {watch.complications.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No features listed yet.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {watch.complications.map((item) => (
              <ComplicationChip key={item.id} item={item} onSaved={apply} />
            ))}
          </ul>
        )}
        <ComplicationForm watchId={watch.id} onSaved={apply} />
      </section>

      <section className="rounded-lg border border-border bg-card p-4 md:p-6">
        <h2 className="font-serif text-2xl">Details</h2>
        <form className="mt-4 grid gap-4" onSubmit={saveDetails}>
          <Labeled label="Manufacturer" value={manufacturer} onChange={setManufacturer} required />
          <Labeled label="Model" value={model} onChange={setModel} required />
          <Labeled label="Reference number" value={referenceNumber} onChange={setReferenceNumber} placeholder="126610LN" />
          <PhotoField id="detail-photo" value={imageUrl} onChange={setImageUrl} />
          <Labeled
            label="Manufacturer page"
            value={pageUrl}
            onChange={setPageUrl}
            placeholder="https://nomos-glashuette.com/..."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="Price new" value={retailPrice} onChange={setRetailPrice} placeholder="12500" inputMode="decimal" />
            <Labeled
              label="Cheapest on Chrono24"
              value={chrono24Price}
              onChange={setChrono24Price}
              placeholder="10950"
              inputMode="decimal"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Changing a price records it for today. Clear a field to remove the latest quote.
          </p>
          <Labeled
            label="Chrono24 link"
            value={chrono24Url}
            onChange={setChrono24Url}
            placeholder="https://www.chrono24.com/..."
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="button" variant="destructive" onClick={removeWatch}>
              Delete watch
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PriceListItem({
  price,
  onSaved,
}: {
  price: WatchDetail["prices"][number];
  onSaved: (watch: WatchDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState<PriceSource>(price.source);
  const [amount, setAmount] = useState(centsToDollarsInput(price.amountCents));
  const [recordedOn, setRecordedOn] = useState(price.recordedOn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginEdit() {
    setSource(price.source);
    setAmount(centsToDollarsInput(price.amountCents));
    setRecordedOn(price.recordedOn);
    setError(null);
    setEditing(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await fetchJson<WatchDetail>(`/api/prices/${price.id}`, {
        method: "PATCH",
        body: JSON.stringify({ source, amount, recordedOn }),
      });
      setEditing(false);
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update price");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <li className="py-3">
        <form className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor={`price-${price.id}-source`}>Source</Label>
            <SourceSelect id={`price-${price.id}-source`} value={source} onChange={setSource} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`price-${price.id}-amount`}>Amount</Label>
            <Input
              id={`price-${price.id}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`price-${price.id}-date`}>Date</Label>
            <Input
              id={`price-${price.id}-date`}
              type="date"
              value={recordedOn}
              onChange={(event) => setRecordedOn(event.target.value)}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive sm:col-span-4">{error}</p> : null}
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="text-muted-foreground">{price.recordedOn}</span>
        <span className="mx-2 text-muted-foreground">·</span>
        {price.source === "retail" ? "New" : "Chrono24"}
      </span>
      <span className="flex items-center gap-1">
        <span className="tabular font-medium">{formatMoney(price.amountCents)}</span>
        <Button type="button" size="icon" variant="ghost" aria-label="Edit price" onClick={beginEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Delete price"
          onClick={async () => {
            const next = await fetchJson<WatchDetail>(`/api/prices/${price.id}`, { method: "DELETE" });
            onSaved(next);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </span>
    </li>
  );
}

function PriceForm({ watchId, onSaved }: { watchId: number; onSaved: (watch: WatchDetail) => void }) {
  const [source, setSource] = useState<PriceSource>("chrono24");
  const [amount, setAmount] = useState("");
  const [recordedOn, setRecordedOn] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await fetchJson<WatchDetail>(`/api/watches/${watchId}/prices`, {
        method: "POST",
        body: JSON.stringify({ source, amount, recordedOn }),
      });
      setAmount("");
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record price");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end" onSubmit={onSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="price-source">Source</Label>
        <SourceSelect id="price-source" value={source} onChange={setSource} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="price-amount">Amount</Label>
        <Input id="price-amount" inputMode="decimal" value={amount} placeholder="10950" onChange={(event) => setAmount(event.target.value)} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="price-date">Date</Label>
        <Input id="price-date" type="date" value={recordedOn} onChange={(event) => setRecordedOn(event.target.value)} required />
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Record"}
      </Button>
      {error ? <p className="text-sm text-destructive sm:col-span-4">{error}</p> : null}
    </form>
  );
}

function ComplicationChip({
  item,
  onSaved,
}: {
  item: WatchDetail["complications"][number];
  onSaved: (watch: WatchDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginEdit() {
    setName(item.name);
    setError(null);
    setEditing(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) {
      setName(item.name);
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await fetchJson<WatchDetail>(`/api/complications/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed }),
      });
      setEditing(false);
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update complication");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex max-w-full flex-col gap-1">
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={onSubmit}>
          <Input
            aria-label={`Edit ${item.name}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-40"
            autoFocus
            required
          />
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <span className="flex items-center gap-1 rounded-full border border-border bg-background pl-3 pr-1 text-sm">
          {item.name}
          <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${item.name}`} onClick={beginEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Remove ${item.name}`}
            onClick={async () => {
              const next = await fetchJson<WatchDetail>(`/api/complications/${item.id}`, { method: "DELETE" });
              onSaved(next);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

function ComplicationForm({ watchId, onSaved }: { watchId: number; onSaved: (watch: WatchDetail) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const next = await fetchJson<WatchDetail>(`/api/watches/${watchId}/complications`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setName("");
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add complication");
    }
  }

  return (
    <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={onSubmit}>
      <div className="grid min-w-0 flex-1 gap-2">
        <Label htmlFor="complication-name">Add a feature</Label>
        <Input
          id="complication-name"
          list="detail-complications"
          value={name}
          placeholder="GMT"
          onChange={(event) => setName(event.target.value)}
          required
        />
        <datalist id="detail-complications">
          {SUGGESTIONS.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </div>
      <Button type="submit">Add</Button>
      {error ? <p className="text-sm text-destructive sm:basis-full">{error}</p> : null}
    </form>
  );
}

function SourceSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: PriceSource;
  onChange: (value: PriceSource) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as PriceSource)}
      className="h-10 rounded-md border border-border bg-background px-3 text-sm md:h-9"
    >
      <option value="retail">New</option>
      <option value="chrono24">Chrono24</option>
    </select>
  );
}

function Labeled({
  label,
  value,
  onChange,
  required,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        required={required}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
