# Foroige club rota

A volunteer rota for a Foroige club: who is covering each club night and each
event, behind a personal code. Two static pages, one Netlify Function, no
framework and no build for the pages.

Owner: Craig Hill (craigrhill).

Lifted from the leaders' rota in `craigrhill/7thclarescouts-content`, where it
was built and tested first. The two are the same design and still diff
cleanly against `netlify/src/rota.mjs` there. A fix to the store access, the
token logic or the conditional-write retry in one probably belongs in the
other.

## Conventions (follow these)

* **No em dashes** in any prose or UI text. Use commas, colons or brackets.
* Verify UI changes with headless Chromium screenshots at 390px and 1280px
  before reporting them done. Chromium is preinstalled; do not run
  `playwright install`.
* `main` is production and auto-deploys. Work on `dev` and merge.
* Commit the built function together with its source, every time.

## The rule this exists to enforce

Every club night and event needs three leaders, and on a club night one of
them must hold the building specific training from the ETB. Events are away
from the building and do not need one.

So a person carries a `trained` flag, and a club carries three numbers:
`required`, `requiredTrained` for club nights and `requiredTrainedEvents` for
events, defaulting to 3, 1 and 0. A single night or event can override any of
them. Which default applies is read off the slot id, `m:` for a club night
and `e:` for an event, in `defaultTrained()`; that is also why an override is
only collapsed against its own kind's default. A club night with the numbers
but nobody trained reads as a warning, not as covered.

## Layout

    rota.html               coverage, everyone
    roster.html             the coordinator's page, including bulk add
    rota-lib.js             shared sign-in, API calls, config loading
    rota.css                shared styles
    rota-config.json        the club, its nights, its events, the training
    netlify/src/foroige.mjs the function, edit this one
    netlify/functions/      built by `npm run build:function`, never edit
    tools/test-foroige.mjs  offline harness, 74 cases
    tools/serve.mjs         local preview, real function, in-memory store

Club nights come from a section's `dates` (a list, for when the dates are
confirmed one at a time) or its `day` (a weekday, which fills eight weeks) or
both. Events are the separate `events` array. The split is not cosmetic: it
is what decides whether the training rule applies.

## Roles and the store

Everything lives in the private Blobs store `foroige`. Keys: `secret` (the
HMAC key, generated on first use, never leaves the server), `roster` (people
with `id`, `name`, `sections`, `trained`, `lead`, `secretary`, `codeHash`),
`section/<key>` (the three numbers and `slots`, each slot `who` as person
ids, `off`, and optional `need` and `needTrained`).

Roles are flags on a person and the function enforces them, not the pages.
The field names are `secretary` and `lead`, kept so the two rotas stay
diffable; the words shown are **coordinator** (keeps the roster) and **club
leader** (sets the numbers, ticks anyone, calls a night off). Anyone else
ticks only themselves. While no coordinator exists, club leaders hold the
coordinator's powers so nobody is locked out. The roster always keeps at
least one coordinator.

The first coordinator is created on `roster.html` under "First time setting
this up?" with the admin password. The API is documented at the top of
`netlify/src/foroige.mjs`.

## Gotchas

* **`netlify/functions/foroige.mjs` is a build artifact. Never edit it.** Edit
  `netlify/src/foroige.mjs`, run `npm run build:function`, then
  `npm run test:function`, and commit both files together. Most of its lines
  are bundled `@netlify/blobs` vendor code, which is deliberate: it keeps the
  deployed function self-contained. The build script must keep
  `--out-extension:.js=.mjs`, or esbuild writes a `.js` beside the `.mjs` and
  Netlify sees two functions with the same name.
* **No admin password is committed.** `ADMIN_PASSWORD` must be set in
  Netlify, scoped to Functions. A Builds-only scope is invisible to the
  function and looks identical to not setting it. Unset means first-time
  setup returns 503 saying so, which is the safe way round for a public repo.
* **Every write is guarded by the document's etag** and retried on conflict,
  so two people saving at once do not overwrite each other. Keep that: it is
  why the function reads with strong consistency and writes with
  `onlyIfMatch`.
* **A 204 must have a null body.** `new Response("", { status: 204 })` throws
  under the Fetch spec, and every CORS preflight becomes a 502.
* **This repo is public.** No names, no codes, no passwords, ever. The lists
  go into the store through the roster page, not into Git.
* **Playwright:** `text=Sign in` matches a heading before a button of the same
  name. Use `getByRole("button", { name: "Sign in", exact: true })`.
