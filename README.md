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
