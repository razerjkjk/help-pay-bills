# Data Plan

## Context provenance
- `I wonder if we can make an app that people can post their bills on a certain platform or something like that where rich people who are filthy rich can help pay those bills.` (verbatim build request; defines the core: people post bills, donors help pay them)
- `Um I think they can we'd have to set something up where they they would pay it` (verbatim build request, answering the donor-pays-directly question; defines the payment model)
- `the app sends them to that biller's own guest payment page with the account info, so they pay the bill company directly. Then the poster confirms it's paid and the bill shows as funded. No money flows through the app at all` (accepted assistant proposal in the parent conversation; defines the trust model: app never touches money, donor pays the biller, poster confirms)
- `apps I build here are private to you. Strangers can't open them. So a first version here would let you try the whole flow, post a bill, walk the donor paying the biller directly, confirm it's paid, but no outside donor could actually reach it.` (assistant statement accepted by the user's `Build it here so I can try it`; the artifact is a private try-out of the full flow, not a public platform, and must not claim outside donors can reach it)
- No external context applied beyond the above; no biller directory, prices, or sample bills are imported.

## Tested sources
No external sources are used for bill content. Biller payment links are pasted in by the person posting the bill (their own bill's guest-pay link); the artifact never fetches biller pages, prices, or schedules, and no URL is constructed or guessed. Proof photos are uploads supplied by the poster and stored as owned blobs. The SDK blob API was verified in the installed types: `BlobClient.put(key, string | ArrayBuffer | ArrayBufferView | Blob, { contentType })` and `getUrl(key)` exist in `@hatch/space-sdk/dist/server-contract.d.ts`, so an action can accept an image data URL, decode it, store it with `ctx.blobs`, and return a URL for display.

The page background photograph was supplied by the parent agent in the 2026-11-03 edit (see Imagery): the exact file was downloaded from the supplied URL, verified as a JPEG, and copied into owned storage; the artifact never loads it from the remote URL at runtime.

Display lettering in the 2026-11-04 futuristic restyle loads two openly licensed Google Fonts at runtime (Sora for headlines, amounts, and body; JetBrains Mono for labels, status pills, and HUD text), with system sans/mono fallbacks if they fail to load: https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap — no bill content comes from this source. The Archivo / Playfair Display pairing from the earlier same-day restyle was replaced by this one.

## Imagery
The full-page background is a real photograph supplied in the 2026-11-03 edit ("something realistic something that says we are all gods children"): a diverse congregation worshipping together in a church — hands raised, a cross and stained-glass window in warm light. Source file: https://publisherdigest.com/wp-content/uploads/2026/05/People_worshipping_in_church_202605060123-1170x653.jpeg (source page: https://publisherdigest.com/the-heart-of-the-digital-ministry-how-faith-finds-a-home-in-the-modern-age/). The downloaded file was verified before use (JPEG, 1170×653, 127 KB) and opened to confirm it depicts the congregation described; it is stored as an owned asset (`client/src/assets/congregation-worship.jpg`) imported by the client and never loaded from the remote URL at runtime. In the 2026-11-04 futuristic restyle ("This is 2026 and this app should be very futuristic") the photograph stopped covering the whole page: it now fills only the hero panel, under a dark gradient and a cyan/violet light wash, with a pulsing live dot, mono HUD labels, and a three-step strip ("Pay the biller direct · Poster confirms · $0 through this app"). The rest of the page is a single dark system — deep space black (#04070f), glass cards, a fine fading HUD grid, electric cyan (#22d3ee) as the one action colour with violet (#8b7cff) only as a secondary glow, cyan-to-violet progress bars, and mono status pills — replacing the warm parchment / vermilion / gold / teal / plum palette, the stained-glass strips, the gold offset shadows, and the Playfair Display drop cap. Lettering is Sora (headlines, amounts, body) and JetBrains Mono (labels, status, HUD text), loaded from Google Fonts: https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap — no bill content comes from this source. The generated dawn-sunrise illustration used previously (`dawn-neighborhood.webp`) was removed in the 2026-11-03 edit. Bills themselves are text, amounts, dates, and progress; the only other images are optional proof photos the poster uploads themselves (with a prompt to cover account numbers first).

## Long-term data behavior
- **Refresh policy**: No schedule. Data is user-entered in this private prototype; the list refreshes on demand and after every write via query invalidation. No refresh trigger was requested.
- **Growth**: Starts empty — no sample or demo bills are seeded, since none were supplied or requested. Bills and donor-reported payments accumulate only from what the user enters while trying the flow; poster can edit or delete a bill, and deleting a bill removes its recorded payments with it.
- **Ordering**: Bills needing help sort by due date (most urgent first, overdue first); fully funded / confirmed-paid bills sort after open ones. Within the same due date, newest posted first.
- **Time semantics**: Due dates are calendar dates (YYYY-MM-DD) as entered by the poster, shown as entered with urgency computed from the viewer's local date (overdue / due in N days). Created/updated instants are stored as timestamps and rendered viewer-local. Amounts are stored as integer cents to avoid float error; donor-reported amounts are capped at the bill's remaining amount.

## Rejected approaches
- **Tried**: Seeding example bills so the list looks full on first open.
  **Why rejected**: No real bills were supplied and none were requested as samples; invented bills would present fabricated debts as content. The empty state instead explains the three-step flow and points at Post a bill.
- **Tried**: A directory of billers with built-in payment links.
  **Why rejected**: Payment URLs could not be verified for arbitrary billers and guessing them risks sending donors to wrong pages; the poster pastes the exact guest-pay link from their own bill.
- **Tried**: In-app payments / collecting money through the artifact.
  **Why rejected**: The accepted proposal rules this out — the app never touches money; donors pay the biller directly and return to record what they paid, and the poster confirms.
- **Tried**: Showing full account numbers on bill listings.
  **Why rejected**: Privacy and trust. Listings show first name only, biller, amount, due date, and story; payment reference details live only inside the donor help flow, and the post form warns to cover account numbers on proof photos.

## Standalone public edition (2026-11-08) — note on this document

Everything above describes the original Muse-hosted build. In the
standalone edition in this repo, two statements no longer apply as written:

- "Proof photos are … stored as owned blobs" via the Muse SDK — proof
  photos are now stored as plain files under the uploads directory
  (`UPLOADS_DIR`, served at `/uploads/*`); see `server/src/actions.ts`.
- "This artifact is a private try-out … no outside donor could actually
  reach it" — this edition is meant to be hosted publicly. It now has
  accounts, ownership, reports with an admin panel, and rate limits; see
  the README's "Accounts and moderation".
