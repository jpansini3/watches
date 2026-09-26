# Watches

A list of watches to buy. Each watch has a photo, manufacturer, model, the price of a new one, and the cheapest Chrono24 price. Open a watch for a price graph and its complications. Next.js + **Postgres** (Drizzle). Uploads use local disk when `R2_*` is unset, or Cloudflare R2 (`pansini-uploads`) in the cluster.

**Look up details** on the add form fills the photo, features, and prices when you enter a manufacturer and model. The new price comes from the manufacturer's US site. Chrono24 blocks automated price lookups, so that field gets the lowest matching dealer ask and a Chrono24 search link you can check.

## Local

Node 24+:

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL
docker compose up -d postgres
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Health check: `/api/health`.

Local Postgres is published on **5434** so it does not collide with other apps on 5432 or travel-plans on 5433.

Full stack Docker:

```bash
docker compose up --build
```

`DATABASE_URL` is required. Uploads default to `./uploads` (`UPLOADS_PATH`) unless R2 env vars are set.

## Deploy (dev + prod)

| Env | Trigger | Atlas pin | Argo app | URL |
|-----|---------|-----------|----------|-----|
| **Dev** | Merge to `main` | CI updates `overlays/dev` `newTag` to the git SHA | `watches-dev` (auto-sync) | `https://dev-watches.pansini-cloud.com` |
| **Prod** | Actions → **Deploy to prod** | Copies current dev SHA (or optional input) into `overlays/prod` | `watches` (auto-sync) | `https://watches.pansini-cloud.com` |

1. Merge to `main` → build pushes `ghcr.io/jpansini3/watches:<git-sha>` (package **private**) and pins **dev**.
2. When ready, run workflow **Deploy to prod**.
3. Repo secret `ATLAS_DEPLOY_TOKEN` must be able to push to `pansini-atlas`.

Cluster cutover / R2 uploads: `pansini-atlas/apps/watches/overlays/dev/README.md`.
