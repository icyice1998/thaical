# Export contract

The website is **read-only**. It never touches MySQL. It reads two files:

- `data/products.json` — the stock snapshot (array of products)
- `data/meta.json`     — when the snapshot was produced

Your export job (run at/near shop close, while the PC is on) writes these two
files and pushes them. That is the entire integration surface. Match this shape
and the site keeps working; nothing else needs to change.

## data/products.json

An array of objects. Fields the site uses:

| field           | type              | required | meaning                                  |
|-----------------|-------------------|----------|------------------------------------------|
| `id`            | string            | yes      | product code (`tb_product.product_id`)   |
| `name`          | string            | yes      | name shown first                          |
| `name_th`       | string            | no       | Thai name shown under `name`              |
| `category`      | string            | no       | group for reports (defaults to `—`)       |
| `unit`          | string            | no       | tablet / capsule / inhaler …             |
| `price`         | number            | no       | selling price per unit (THB)             |
| `cost`          | number            | no       | unit cost (THB) — used for valuation     |
| `on_hand`       | number            | no       | current quantity in stock                |
| `reorder_point` | number            | no       | low-stock threshold; 0 = no threshold    |
| `active`        | boolean           | no       | `false` = hidden by default (soft-delete)|
| `expiry`        | string `YYYY-MM-DD` or null | no | earliest/nearest lot expiry           |

Missing fields are tolerated (numbers default to 0, `active` defaults to true).
`id` and `name` are the only ones you must always provide.

A product is **low stock** when `active` and `reorder_point > 0` and
`on_hand < reorder_point`. A product shows an **expiry warning** when `expiry`
is within 90 days.

> The field names above are the site's contract, not the legacy column names.
> Map the real `tb_product` columns to these in your SELECT. Confirm the exact
> source columns (price/cost/on-hand live across a few tables in the old app)
> before trusting the numbers.

## data/meta.json

```json
{
  "generated_at": "2026-10-18T19:55:00+07:00",
  "source": "MySQL 4.0 / tb_product",
  "row_count": 3000,
  "currency": "THB"
}
```

`generated_at` should be the real export time (ISO 8601 with timezone) so the
header shows "updated …" honestly. `row_count` is informational.

## Example source query (MySQL 4.0)

MySQL 4.0 has no subqueries, views, or CTEs, so keep the SELECT flat — join
only, and do any aggregation in your export code, not in SQL. Column names here
are placeholders; replace with the verified ones.

```sql
SELECT p.product_id, p.product_name, p.category, p.unit,
       p.sale_price, p.cost_price, p.qty_on_hand, p.reorder_point,
       p.product_active, p.expiry_date
FROM   tb_product p
ORDER  BY p.product_name;
```

Then in the export program: map rows to the JSON fields above
(`product_active = "0"` → `active: false`), write `data/products.json` and
`data/meta.json`.

## Publishing the two files

### Option A — commit to this repo (what the site reads now)

```bash
# after the export program has written the two files:
git add data/products.json data/meta.json
git commit -m "stock snapshot $(date +%F)"
git push
```

Each push becomes a dated snapshot in git history, so you can diff stock
between days for free. GitHub Pages serves the new data within a minute.

### Option B — Supabase (only if you later outgrow a flat file)

Keep the exact same JSON objects; upsert them into a `products` table instead of
committing a file. The website would then read from Supabase rather than
`data/products.json` (small change in `app.js`). Switch to this only when the
snapshot gets too large to ship as a file or you need server-side queries over
history.

```sql
-- one-time table
create table products (
  id text primary key, name text, name_th text, category text, unit text,
  price numeric, cost numeric, on_hand int, reorder_point int,
  active boolean default true, expiry date, updated_at timestamptz default now()
);
```

Upsert the array with the Supabase client (service key, from the PC only — never
in the website). The anon key the website uses should have **read-only** access.
