# Watches

A list of watches to buy. Each watch has a photo, manufacturer, model, the price of a new one, and the cheapest Chrono24 price. Open a watch for a price graph and its complications. Next.js + **Postgres** (Drizzle). Uploads use local disk when `R2_*` is unset, or Cloudflare R2 (`pansini-uploads`) in the cluster.

**Fill from this page** on the add form reads a manufacturer product URL and fills the name, photo, US price, and features. It uses the schema.org or Open Graph product data on that page, so it works for any manufacturer that publishes those tags. The Chrono24 price is not filled in automatically. **Look up details** still searches by manufacturer and model when you don't have a product URL. The photo comes from the manufacturer's site, or from a dealer listing when that site has no photo. The new price comes from the manufacturer's US site when that page publishes product data. Chrono24 blocks automated price lookups, so the form keeps a Chrono24 search link and leaves that price for you to enter.

## Local

Node 24+. Data uses the shared Homebrew Postgres on `127.0.0.1:5432` (`brew services list`). Do not run `docker compose up -d postgres` — that collides with the shared instance. New app databases: [new-app.md](https://github.com/jpansini3/pansini-atlas/blob/main/templates/new-app.md).

```bash
npm install
cp .env.example .env.local   # DATABASE_URL already points at 5432
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Health check: `/api/health`.

Full stack Docker (stop Homebrew Postgres first so port 5432 is free):

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
