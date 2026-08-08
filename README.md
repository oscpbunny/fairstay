# FairStay

Property services made simple — Rental agreements, packers & movers, and property buy, sell & rent services.

## Live Site

[https://fairstay.co.in](https://fairstay.co.in)

## Project Structure

- `index.html` — Main landing page with hero section, services, pricing plans, and lead capture modal
- `rental-details.html` — Comprehensive rental agreement form (Property, Owner, Tenant, Contract & Amenities)
- `packers-movers.html` — Packers & movers booking page with quote widget
- `find-property.html` — Property search & listings page (Buy • Sell • Rent)
- `coming-soon.html` — Coming soon placeholder for upcoming services
- `setup-google-sheet.txt` — Instructions for connecting the Google Sheet backend

## Features

- ✅ Clickable plan selection with modal popup
- ✅ Lead capture form (Name, Phone, Email, City)
- ✅ Unique Customer ID generation (FS + timestamp) for tracking
- ✅ Full rental agreement details form (50+ fields)
- ✅ Google Sheet backend integration for data storage
- ✅ Sticky navigation with blinking announcement banner
- ✅ Responsive design (mobile-friendly)
- ✅ Coming soon pages for upcoming services

## Deployment

This site is deployed via GitHub Pages with a custom domain. To deploy your own copy:

1. Fork this repository
2. Enable GitHub Pages in repo Settings → Pages
3. Set custom domain to your domain
4. Update `SCRIPT_URL` in `index.html` and `rental-details.html` with your Google Apps Script URL
5. Configure your domain's DNS (CNAME record pointing to `yourusername.github.io`)

## Backend Setup

See `setup-google-sheet.txt` for detailed instructions on setting up the Google Sheet backend.

## License

All rights reserved. FairStay.co.in