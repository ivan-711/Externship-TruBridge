# Patient No-Show Dashboard (React + Vite)

Live demo: https://patient-noshow-dashboard.vercel.app/  
Repo: https://github.com/ivan-711/Externship-TruBridge

## What this is
React dashboard for exploring patient no-show patterns by:
- Age group
- SMS reminder status
- Waiting time (lead time)
- Week-to-week trend

## Data
The dashboard loads `public/publicsafefinalnoshowdataset.csv` (110,516 rows). It is the notebook's
public-safe export (`docs/notebook/TruBridge_NoShow_Analysis_FINAL.ipynb`, with the patient and
appointment ID columns removed) minus 5 records with Age 115, plus label columns for the charts.
Waiting days are calendar days from booking to appointment (same-day = 0).

## Run locally
```bash
cd patient-dashboard
npm install
npm run dev
