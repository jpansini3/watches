"use client";

import { useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { fetchJson } from "@/lib/client";
import { cn } from "@/lib/utils";

export function PhotoField({
  id,
  label = "Photo",
  value,
  onChange,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await fetchJson<{ url: string }>("/api/uploads", {
        method: "POST",
        body: form,
      });
      onChange(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={onFile}
          disabled={uploading}
          className="min-w-0 sm:max-w-xs"
        />
        <Input
          placeholder="or paste an image URL"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0"
        />
      </div>
      {uploading ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt=""
          className={cn("h-28 w-28 rounded-lg border border-border object-cover")}
        />
      ) : null}
    </div>
  );
}
