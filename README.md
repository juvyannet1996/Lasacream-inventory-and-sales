# Bakeshop

A small internal tracker for inventory, recipes, purchases, sales, and stock history.

Inventory changes only through a ledger: purchases add stock, sales deduct the ingredients actually used, and wastage or count corrections are adjustments. Costs use weighted average. Old sales keep the quantities and cost from the day they were saved.

## Run on this computer

```bash
npm install
npm run dev
```

Open http://localhost:3000. The database is created at `data/bakeshop.db` and starts with sample stock, recipes, and one sale. Delete that file to start over. That file stays on this computer only.

```bash
npm test
npm run lint
```

Node 22 or newer is required.

## Cloudflare

The public site stores products, inventory, purchases, sales, and stock history in Cloudflare D1. D1 keeps that data when the computer is off and when the site is idle. A sale entered today is still there tomorrow.

On this computer, `npm run dev` still uses `data/bakeshop.db`. The Cloudflare site uses D1. They are separate copies.

The public site is https://lasacream-bakeshop.lasacream.workers.dev. Its products, inventory, purchases, sales, and stock history are stored in the Cloudflare D1 database named `lasacream`.
