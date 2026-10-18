# SmartDrugstore

A small, read-only **stock monitoring and reporting** website for a pharmacy
whose live data lives in a legacy **MySQL 4.0** database on the shop PC.

The shop PC is only on during business hours, but stock needs to be viewable
after closing. So the site never connects to the database directly. Instead, an
end-of-day export writes a JSON snapshot that is hosted statically and stays
online 24/7.

## How it works

```
SHOP PC (open hours only)                 GITHUB (always on, free)        YOU (anytime)
 MySQL 4.0
    | old Connector/J (you own this)
 export job (run at ~shop close):
    - SELECT products / stock
    - write data/products.json
      + data/meta.json          --git push--> GitHub Pages serves:
                                                 index.html, app.js, styles.css
                                                 data/*.json  <-- fetch --- browser:
                                                                            stock view + reports
```

Why a snapshot is enough: the shop is closed after hours, so stock does not
change — the last export of the day is an accurate overnight picture, not stale
data.

## What's here

| path                      | purpose                                                    |
|---------------------------|------------------------------------------------------------|
| `index.html`              | the page (Stock tab + Reports tab)                         |
| `app.js`                  | loads the JSON, renders the table and reports (no deps)    |
| `styles.css`              | styling, light/dark aware, mobile-friendly                 |
| `data/products.json`      | the stock snapshot (sample data for now)                   |
| `data/meta.json`          | snapshot timestamp + row count                             |
| `sync/EXPORT_CONTRACT.md` | the exact JSON shape your export job must produce          |

## Features (v1)

- **Stock view** — search, category filter, low-stock-only toggle, sortable
  columns, show/hide inactive products.
- **Reports** — low stock, stock valuation by category (cost + retail), product
  count by category, items expiring within 90 days, inactive products.
- Summary cards (active count, low-stock count, stock value).
- Works offline; no backend; nothing writes back to the pharmacy database.

## Running locally

```bash
python3 -m http.server 8137
# open http://localhost:8137/
```

Open `file://…/index.html` directly will fail because the page uses `fetch` —
serve it over HTTP (the command above, or GitHub Pages).

## Deploying (GitHub Pages)

1. Push this branch / merge to the default branch.
2. Repo **Settings → Pages** → Source: *Deploy from a branch* → pick the branch
   and `/ (root)` → Save.
3. The site appears at `https://<user>.github.io/<repo>/` within a minute.

To update the data, the export job overwrites `data/products.json` +
`data/meta.json` and pushes — see `sync/EXPORT_CONTRACT.md`.

## Roadmap

- Ad-hoc SQL reports in the browser (sql.js / alasql over the snapshot).
- Historical sales / movement reports (needs a sales export; large history may
  move to Supabase).
- Supabase as the store if the snapshot outgrows a flat file or needs
  server-side queries.

## Status

v1 scaffold with sample data. The field names in `data/products.json` are the
site's contract; map the real `tb_product` columns to them in the export.
