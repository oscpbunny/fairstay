# FairStay

Property services made simple — Rental agreements, packers & movers, and property buy, sell & rent services.

## Live Site

[https://fairstay.co.in](https://fairstay.co.in)

## Project Structure

- `index.html` — Main landing page with hero section, services, pricing plans, and lead capture modal
- `rental-details.html` — Comprehensive rental agreement form (Property, Owner, Tenant, Contract & Amenities)
- `rental-draft.html` — Upload-your-own-draft flow (image/PDF saved to Drive)
- `packers-movers.html` — Packers & movers booking page with quote widget
- `find-property.html` — Property search & listings page (Buy • Sell • Rent)
- `list-property.html` — List your property page (Rent • Sale)
- `coming-soon.html` — Coming soon placeholder for upcoming services
- `fs-tracker.js` — Shared frontend helper (captures login details + service + payment amount + status, uploads drafts to Drive, "Confirm Payment" button)
- `fairstay-backend.gs` — Google Apps Script backend (deploy as a Web App)
- `AdminPage.html` — Admin console for the Apps Script (init sheets, refresh report, flip lead status by Customer ID)
- `setup-google-sheet.txt` — Instructions for connecting the Google Sheet + Drive backend

## Features

- ✅ Clickable plan selection with modal popup
- ✅ Lead capture form (Name, Phone, Email, City) → captured on the sheet on login
- ✅ Unique Customer ID generation (FS + timestamp) for tracking
- ✅ Full rental agreement details form (50+ fields)
- ✅ Google Sheets backend: per-service sub-sheets + a "Leads" master sheet
- ✅ Payment Amount + dedicated **Status** column (Success / Pending / Rejected)
- ✅ Draft image/PDF upload → saved to Google Drive, link written back to the sheet
- ✅ Auto-generated **Report** sub-sheet: Total Revenue + month-wise Pending / Success / Rejected leads
- ✅ Admin console (web-app URL) to initialize sheets, refresh the report, and update lead status
- ✅ Sticky navigation with blinking announcement banner
- ✅ Responsive design (mobile-friendly)
- ✅ Coming soon pages for upcoming services

## Deployment

This site is deployed via GitHub Pages with a custom domain. To deploy your own copy:

1. Fork this repository
2. Enable GitHub Pages in repo Settings → Pages
3. Set custom domain to your domain
4. Deploy the Google Apps Script backend (see `setup-google-sheet.txt` and `fairstay-backend.gs`)
5. Update `SCRIPT_URL` in **every** HTML page (`index.html`, `rental-details.html`, `rental-draft.html`, `find-property.html`, `list-property.html`, `packers-movers.html`) with your Google Apps Script URL
6. Upload `fs-tracker.js` in the same folder as the pages
7. Configure your domain's DNS (CNAME record pointing to `yourusername.github.io`)

## Backend Setup

See `setup-google-sheet.txt` for detailed instructions on setting up the Google Sheets + Drive backend (`fairstay-backend.gs`, `AdminPage.html`, `fs-tracker.js`).

## License

All rights reserved. FairStay.co.in