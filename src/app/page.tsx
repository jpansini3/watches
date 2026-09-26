import { WatchCollection } from "@/components/watch-collection";
import { dbReady } from "@/lib/db";
import { listWatches } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await dbReady;
  const watches = await listWatches();
  return <WatchCollection initialWatches={watches} />;
}
