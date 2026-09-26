import { notFound } from "next/navigation";
import { WatchDetailView } from "@/components/watch-detail";
import { dbReady } from "@/lib/db";
import { parseId } from "@/lib/api";
import { getWatch } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) notFound();
  const watch = await getWatch(id);
  if (!watch) notFound();
  return <WatchDetailView initialWatch={watch} />;
}
