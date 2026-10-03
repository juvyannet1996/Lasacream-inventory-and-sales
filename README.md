# Bakeshop

A small internal tracker for inventory, recipes, purchases, sales, and stock history.

Inventory changes only through a ledger: purchases add stock, sales deduct the ingredients actually used, and wastage or count corrections are adjustments. Costs use weighted average. Old sales keep the quantities and cost from the day they were saved.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. The database is created at `data/bakeshop.db` and starts with sample stock, recipes, and one sale. Delete that file to start over.

```bash
npm test
npm run lint
```

Node 22 or newer is required. Stock is stored with the built-in SQLite module.

## Put it on Render

`render.yaml` describes a free web service. From the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint**, connect this GitHub repo, and apply the blueprint. Render builds with `npm ci && npm run build` and starts with `npm start`. The public address looks like `https://lasacream-bakeshop.onrender.com`.

The free instance sleeps after about 15 minutes with no visitors. The next open takes about a minute while it wakes.

The free plan has no persistent disk. On its own, purchases, sales, and stock in `data/bakeshop.db` are erased when the service sleeps, restarts, or redeploys.

When `BAKESHOP_S3_ENDPOINT`, `BAKESHOP_S3_BUCKET`, `BAKESHOP_S3_ACCESS_KEY_ID`, and `BAKESHOP_S3_SECRET_ACCESS_KEY` are set, each saved change is copied to that storage and loaded again the next time the site wakes. A sale entered today is still there tomorrow. If the copy fails, the change is not kept.

There is no login. Anyone with the address can change stock.
