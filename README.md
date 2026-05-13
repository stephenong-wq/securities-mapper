# Securities Mapper

Map client holdings to model portfolio equivalents using Morningstar style/category data.

## Features
- **5 configurable models** (rename in `src/lib/types.ts`)
- **Paste tickers** — comma or newline separated
- **Split mappings** — e.g. IXUS → IEFA 78% / IEMG 22%
- **Morningstar style & category** shown per mapped security
- **CSV export** of results
- **Vercel Blob** for monthly data updates (no redeploy needed)
- **Sample data** built-in — works out of the box before real files are uploaded

---

## Deployment Guide

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial"
gh repo create securities-mapper --private --push
# or manually create on github.com and push
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Click **Import Git Repository** → connect GitHub → select `securities-mapper`
3. Framework: **Next.js** (auto-detected)
4. Click **Deploy** — live in ~60 seconds

### 3. Set up Vercel Blob Storage

In your Vercel dashboard:
1. Go to **Storage** tab → **Create Database** → choose **Blob**
2. Name it `securities-data` → Create
3. It will automatically add `BLOB_READ_WRITE_TOKEN` to your env vars

### 4. Upload your Excel files to Blob

In the Vercel Blob dashboard:
1. Click **Upload** → upload `morningstar_data.xlsx`
2. Copy the public URL shown
3. Upload `model_universe.xlsx` → copy its URL

### 5. Add environment variables

In Vercel dashboard → **Settings** → **Environment Variables**:

```
MORNINGSTAR_BLOB_URL    = https://xxx.public.blob.vercel-storage.com/morningstar_data.xlsx
MODEL_UNIVERSE_BLOB_URL = https://xxx.public.blob.vercel-storage.com/model_universe.xlsx
```

Click **Save** → **Redeploy** once (only needed this first time).

After this, your **monthly update process is just**: upload new Excel → Blob URL stays the same → app auto-picks up changes within 1 hour (cached).

---

## Excel File Formats

### morningstar_data.xlsx
Columns (names are flexible — we normalize):

| ticker | name | msStyle | assetClass | region | factors | splitRegions |
|--------|------|---------|-----------|--------|---------|-------------|
| VTI | Vanguard Total Stock Market ETF | Large Blend | US Equity | US | | |
| IXUS | iShares Core MSCI Total Intl | Foreign Large Blend | Intl Equity | Global ex-US | | Developed ex-US:0.78,Emerging:0.22 |

`splitRegions` format: `Region1:weight,Region2:weight` (weights should sum to 1)

### model_universe.xlsx
Columns:

| modelId | ticker | name | role |
|---------|--------|------|------|
| core-allocation | VOO | Vanguard S&P 500 ETF | US Large Cap Core |
| factor-tilt | AVUV | Avantis US Small Cap Value | US Small Cap Value |

**Model IDs** (must match exactly):
- `core-allocation`
- `factor-tilt`
- `esg-responsible`
- `active-blend`
- `institutional-plus`

---

## Customizing Models

Edit `src/lib/types.ts` → `MODELS` array. Change `id`, `label`, `description` freely.
Then update `model_universe.xlsx` to use your new model IDs.

---

## Local Development

```bash
npm install
cp .env.example .env.local
# Leave env vars blank to use sample data
npm run dev
# → http://localhost:3000
```
