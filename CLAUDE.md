# Foróige club rota

A volunteer rota for a Foróige club: who is covering each club night and each
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
events, defaulting to 3, 1 and 0. A single night can say otherwise with
`need` and `needTrained` on its own calendar entry. A club night with the
numbers but nobody trained reads as a warning, not as covered.

**All of those numbers are the coordinator's**, set on `roster.html`: the
club's three on the numbers card, a single night's on its calendar row, where
that night is created and edited. Whether a night is on at all is there too.
`?a=slot` takes only `add` and `remove`, refusing `need`, `needTrained` and
`off` from anyone at all; `?a=required` is behind the same
coordinator gate as the roster and the calendar. The rota page has no
settings on it at all: it states what a night needs and shows the gap. Its
only controls are the two pull-downs, or one button for a plain leader.

Which default a night takes is read off the `m:` or `e:` on its slot id, and
that is now only done in `rota.html` (`needOf`, `needTOf`). The numbers are
advisory: the function never refuses a tick for going over them.

## Layout

    rota.html               coverage, everyone. No settings: see above
    events.html             the public page. No sign-in, no names
    roster.html             the coordinator's page, including bulk add
    rota-lib.js             shared sign-in, API calls, config loading
    rota.css                shared styles
    rota-config.json        the club, its nights, its events, the training
    netlify/src/foroige.mjs the function, edit this one
    netlify/functions/      built by `npm run build:function`, never edit
    tools/test-foroige.mjs  offline harness, 138 cases
    tools/serve.mjs         local preview, real function, in-memory store

## The calendar

The coordinator keeps it on the roster page, where it reads as the same list
of nights everybody else sees, one row each with an Edit. Only an open row
shows input boxes, and adding a night opens straight into them, since a new
night has nothing to show yet. Which rows are open is held in `openRows` by
position, and cleared on any add, remove or save so it can never point at the
wrong night. It lives in the store under `calendar`, as `entries: [{ id, kind, date, endDate?, title, location,
details, need?, needTrained?, off? }]`. `kind` is `m` for a club night and `e` for
an event, and that is what decides whether the training rule applies.
`details` is the line shown on the rota under the heading. `need` and
`needTrained` are absent unless this one night differs from the club. `off`
marks a night called off: it stays on the rota, greyed out, because deleting
it would take everyone already down for it too.

Until anything is saved there, both pages fall back to `rota-config.json`:
its `dates` (a list) or `day` (a weekday, which fills eight weeks) for club
nights, and its `events` array. The roster page pre-fills the editor from
that file so the first save carries it across, and the file is ignored from
then on.

**Slot ids hang off the entry id, not the date and name.** `m:<entryId>` and
`e:<entryId>`, so renaming or moving a night keeps everyone already down for
it. `isSlotId` still accepts the older `m:YYYY-MM-DD` and
`e:YYYY-MM-DD:Title` forms, which is what a calendar out of the config file
produces.

The whole calendar is written at once, by `?a=calendar`, rather than an
action per entry. It is a short list, the page holds it while it is being
edited, and one write keeps the etag guard meaningful: two coordinators
editing together conflict and retry rather than interleaving halves.

## The public page

`events.html` is open to anyone with the address and reads
`GET ?a=public&section=<key>`, which takes no token. When the store holds no
calendar yet the page falls back to `rota-config.json`, the same as the rota
does, so the two never disagree about what the term is: without that, the
link handed to parents sat empty while the rota showed fourteen nights. That endpoint returns
dates and **counts**: how many are on a night and how many of those are
trained. No names, no ids, no roster, no slots. That is the whole reason it
can be public, so keep anything personal out of it.

Each night is a card: the date read at a glance on the left, the name and a
line of when and where beside it, and a badge for the kind unless the name
already says it. Anything with more to say opens on a tap, so the page stays
scannable. It prints: the toolbar and the chevrons go, and everything that
opens is opened.

One page, two readings, on the same data:

* plain, it is the calendar for parents: what is on, where, and the line of
  description. No coverage at all, not even the summary banner. A parent
  neither needs to know the club is short nor can do anything about it.
* `?gaps` adds a "Needs 2 more" against each night and the summary. That is
  the link to send when chasing leaders.

Both links are on the rota page for the coordinator, under
Links to share, built by `pageLink()` so they work whether Netlify is serving
the pages pretty (`/events`) or as files.

## Signing in, and first come first served

**The coordinator signs in with her name and the password.** `?a=admin-login`
takes `x-admin-password` and a name, and hands back a token: no code, no
link, nothing to lose. If that name is not on the roster it is added as
coordinator, and if it is there but is not one it becomes one, which is how
the first coordinator is made and how a lost one is recovered. Signing in
does **not** rotate her code, since that would break a link she had been
given. It is the roster page's only way in, and the same throttle guards it,
which is what a four digit password rests on.

**Nobody else types a code either.** A volunteer's code is handed out as a
link,
`/rota?c=XXXX-XXXX`, built by `codeLink()`. `signInFromLink()` spends it on
the first load, stores the token, and `dropCodeFromUrl()` takes it straight
back out of the address bar with `history.replaceState`. A link beats the
token already on the phone, so handing a phone round does the obvious thing.
The code box on the gate still works for anyone who has only the code.

Both pages carry `<meta name="referrer" content="no-referrer">`. Without it
the Google Fonts request would carry the whole URL, code and all, in the
Referer header.

**The rota is where the overriding happens.** The coordinator gets the
pull-downs, can put anyone on or take them off, and is not held to the
numbers. In the page that is the `lead` variable in `render()`, now just
`me.secretary`; in the function it is `boss`.

**A night fills up and then closes.** Anyone puts themselves on while there
is a place; once there is not, the button is gone and `?a=slot` answers 409.
Two things stop that deadlocking, and both matter:

* While a night still wants somebody trained, that many places are **held**:
  an untrained person can only take a place if `on < need - held`. Otherwise
  three untrained people would fill a night that then could never be covered.
* A trained person can get on **even when the night is already full**, if it
  still has nobody trained. That is the escape hatch for a night that got
  into that state anyway, by the coordinator's hand or a change of numbers.

The coordinator is held to none of it and can go over the numbers. The rule is
enforced in the function, inside the read-modify-write so two people racing
for the last place cannot both win, and mirrored in `placeForMe()` on the
page purely so the button knows what to say.

## Roles and the store

Everything lives in the private Blobs store `foroige`. Keys: `secret` (the
HMAC key, generated on first use, never leaves the server), `roster` (people
with `id`, `name`, `sections`, `trained`, `lead`, `secretary`, `codeHash`),
`section/<key>` (the three numbers and `slots`, each slot `who` as person
ids, `off`, and optional `need` and `needTrained`), `calendar` (see above).

There are two kinds of person, and the function enforces the difference, not
the pages. The flag is `secretary`, kept under that name so the two rotas
stay diffable; the word shown is **coordinator**. She keeps the roster, the
calendar and the numbers, and on the rota she puts anyone on a night or takes
them off without being held to those numbers. Everybody else is a
**volunteer**: they put themselves on while there is a place and take
themselves off, and that is all.

**There is no club leader role.** It existed and was taken out: one
coordinator and a flat list of volunteers is the whole model. A `lead` field
sent by an old client is ignored rather than stored. The roster always keeps
at least one coordinator, and the admin password makes another if the only
one is ever lost.

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
  Never put the password, or a hash of it, in this repo: it is public, and a
  hash of anything short is the password.
* **Signing in is throttled.** Fifteen wrong passwords and it answers 429:
  for five minutes, then fifteen, then an hour. Counted in the store under
  `admin-tries` so it holds across function instances, and wiped by a correct
  password. Fifteen goes because the person who hits this is almost always
  the coordinator, not an attacker; long shuttings after because if fifteen
  were not enough the sixteenth was never going to help. It settles at
  fifteen guesses an hour, slower than five tries and a quarter hour was.
* **A deploy clears the lock.** The guard records the deploy that was live
  when it was last written, and a newer one starts the count again. Only
  whoever owns the site can deploy, so it is a reset lever the coordinator
  has and somebody guessing does not. It reads `DEPLOY_ID`, falling back to
  `COMMIT_REF`; with neither set the guard simply persists, which is what
  happens under the local preview and the harness.
* **The password is trimmed at both ends before comparing.** A value pasted
  into Netlify with a trailing space or newline looks identical in their UI
  and would refuse the right password for ever, with nothing at all to see.
* **A wrong password and no password are different answers**, 401 and 503.
  If it says "Wrong password." the function *can* read `ADMIN_PASSWORD`, so
  the value it holds is not the one being typed. Changing an environment
  variable on Netlify needs a redeploy before the function sees it, and a
  variable can hold a different value per deploy context.
* **Every write is guarded by the document's etag** and retried on conflict,
  so two people saving at once do not overwrite each other. Keep that: it is
  why the function reads with strong consistency and writes with
  `onlyIfMatch`.
* **A 204 must have a null body.** `new Response("", { status: 204 })` throws
  under the Fetch spec, and every CORS preflight becomes a 502.
* **This repo is public.** No names, no codes, no passwords, ever. The lists
  go into the store through the roster page, not into Git.
* **Blank is not nought.** `Number(null)` and `Number("")` are both 0, so a
  number field left empty read as "needs nobody" rather than "as the club
  does". `optNum()` keeps blank blank; a typed 0 is still a real answer.
* **An editor held in the page must track `input`, not `change`.** The
  calendar rows did `onchange` at first, so the field someone was typing in
  had not reached the local copy when they clicked Save. Its value was
  dropped, silently.
* **`guarded()` on the roster page reloads before it reports.** `load()`
  clears the error banner on its way in, so showing the message first meant
  no failure was ever visible. Show it after the reload, not before.
* **A capacity rule has to be enforced inside `update()`.** Checking before
  the read-modify-write lets two people take the same last place.
* **Playwright:** `text=Sign in` matches a heading before a button of the same
  name. Use `getByRole("button", { name: "Sign in", exact: true })`. Its
  `fill()` does not reliably fire `change` on the last field before a click,
  which is how the bug above stayed hidden.
