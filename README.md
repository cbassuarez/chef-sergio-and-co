# Chef Sergio & Co.

Public website and request flow, deployed with GitHub Pages.

- Site: https://cbassuarez.com/chef-sergio-and-co/
- Booking requests: https://cbassuarez.com/chef-sergio-and-co/book/
- Private dashboard: https://chef-sergio-admin-preview.bushy-owlet-3273.chatgpt.site

The public **Book with Sergio** journey reads saved availability, published Table nights and booking policies from the private dashboard. Hosts can leave dates and exact headcounts unsettled, select a party-size band, share food ideas and a spending range, and send a planning brief. Unresolved answers become Sergio’s interview checklist. Receipts separate payment from date reservation and protect access with private capability tokens.

Stripe hosted checkout, signed payment notifications, capacity holds, cancellation/refund handling, and private invitation RSVPs are implemented behind server-side configuration. **Live payments remain disabled:** Sergio must own and connect the payment account, and approve deposit amounts, the planning fee, checkout duration and outstanding policies. Until then the live page saves an unpaid planning request, reserves no date or seats, and never fabricates payment success. Email delivery and automatic Google Meet creation are not connected; actual external invitation delivery can be recorded separately in the dashboard.

Final menus must stay within the spending ceiling agreed during the interview. The entire deposit credits the event. Optional physical invitations add a separate configured postage line within the ceiling. Shared event invitations expose event details only; guests’ responses and dietary requirements remain private.

## Ownership and hosting

This repository is owned by cbassuarez and can be transferred to Sergio later. The public source/assets contain no customer database, administrator credentials or service secrets. Pages uses the repository’s deployment workflow. BASE_PATH is /chef-sergio-and-co/ and PUBLIC_URL is https://cbassuarez.com/chef-sergio-and-co. GitHub Pages inherits the owner’s existing cbassuarez.com domain; this project changes no DNS records or the owner’s homepage.

The API runs separately at https://chef-sergio-booking-api.bushy-owlet-3273.chatgpt.site. It relays a fixed set of booking operations to the private dashboard. It cannot proxy arbitrary administrator operations. Runtime credentials are stored only in the hosting service; no private dashboard access is granted by this repository.

Before a future repository transfer, preserve or change the Pages base path and public URL, then update the API’s allowed public origin and the private dashboard’s receipt-link origin/base path. Transfer the hosting projects separately or deploy the backend under Sergio’s hosting account and reconnect these runtime values. No payment account is linked by transferring this repository.

## Working on the site

Install with npm ci. npm run build creates prerendered HTML and runs content/image/navigation/SEO checks. The selected visual design remains in the existing React/Framer Motion components. Source text and open business decisions live in src/content. npm run check:booking verifies the live booking client contract, retry behavior, private receipt tokens and Eastern Time calendar conversion.

The presentation is still a preview where labelled reference photographs or unresolved policy/price markers remain. The booking request service is real: submitted contact details go to Sergio’s private workspace. No payment is collected online.
