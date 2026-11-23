# Chef Sergio & Co.

Public website and request flow, deployed with GitHub Pages.

- Site: https://cbassuarez.com/chef-sergio-and-co/
- Booking requests: https://cbassuarez.com/chef-sergio-and-co/book/
- Private dashboard: https://chef-sergio-admin-preview.bushy-owlet-3273.chatgpt.site

The current public flow reads Sergio’s saved working days, start times, notice period, blocked dates and published Table evenings. Requests are stored in the private dashboard’s database. A request does not hold a date or reserve seats until Sergio accepts it. Public status pages return only a redacted summary protected by a private receipt token. There is no browser mock fallback, card checkout or automatic guest email.

## Ownership and hosting

This repository is owned by cbassuarez and can be transferred to Sergio later. The public source/assets contain no customer database, administrator credentials or service secrets. Pages uses the repository’s deployment workflow. BASE_PATH is /chef-sergio-and-co/ and PUBLIC_URL is https://cbassuarez.com/chef-sergio-and-co. GitHub Pages inherits the owner’s existing cbassuarez.com domain; this project changes no DNS records or the owner’s homepage.

The API runs separately at https://chef-sergio-booking-api.bushy-owlet-3273.chatgpt.site. It relays a fixed set of booking operations to the private dashboard. It cannot proxy arbitrary administrator operations. Runtime credentials are stored only in the hosting service; no private dashboard access is granted by this repository.

Before a future repository transfer, preserve or change the Pages base path and public URL, then update the API’s allowed public origin and the private dashboard’s receipt-link origin/base path. Transfer the hosting projects separately or deploy the backend under Sergio’s hosting account and reconnect these runtime values. No payment account is linked by transferring this repository.

## Working on the site

Install with npm ci. npm run build creates prerendered HTML and runs content/image/navigation/SEO checks. The selected visual design remains in the existing React/Framer Motion components. Source text and open business decisions live in src/content. npm run check:booking verifies the live booking client contract, retry behavior, private receipt tokens and Eastern Time calendar conversion.

The presentation is still a preview where labelled reference photographs or unresolved policy/price markers remain. The booking request service is real: submitted contact details go to Sergio’s private workspace. No payment is collected online.
