# Foroige club rota

Who is covering each club night and each event, behind a personal code.
Nothing on these pages is public and no names are in this repo: the roster,
the ticks and the codes all live in a private Netlify Blobs store that comes
with the site.

The rule it exists to enforce: **every club night and event needs three
leaders, and on a club night one of them must hold the building specific
training from the ETB.** A club night with three untrained leaders on it is
not counted as covered. Events are away from the building, so they need the
three leaders and nobody in particular.

All three numbers are the coordinator's, on the roster page. A single night
that is different is set on its own calendar row, where that night is created
and edited: a night that needs four, or an event that does need somebody
approved after all. Leave those boxes blank and the night asks for whatever
the club asks for.

## The two pages

    rota.html     everyone's page: the club nights and events coming up,
                  ticks, and the gaps
    roster.html   the coordinator's page: who is on the roster, who is
                  approved, who runs the club, codes

    roster.html  \
                  ->  /.netlify/functions/foroige  ->  Blobs store "foroige"
    rota.html    /

Three roles. They are flags on a person and the function enforces them, not
the pages:

* **coordinator** keeps the roster and the calendar: what is on, when,
  whether it has been called off, and how many leaders it needs, for the club
  and for any single night. Adds people, marks who is approved, issues codes.
  There is always at least one.
* **club leader** puts anyone on a night. Everyone else puts on themselves.

**Nobody has to type anything.** Each person gets their own link, shown once
on the roster page and sent to them however suits. Opening it signs that
phone in for 365 days and the code is taken straight back out of the address
bar. Taking someone off the roster revokes their sign-in at once, and takes
them off every night with it. "New link" cancels the old one.

A link is as good as a code: whoever holds it is that person, so it is worth
sending each one to that person rather than to a group.

**Nights are first come, first served.** Anyone can put themselves on a
night while there is a place. Once it has the leaders it needs, it closes.
Two exceptions keep it from jamming: while a night still needs somebody with
the training, that place is held and an untrained person cannot take it; and
somebody with the training can get on a night that is already full but has
nobody trained on it. A club leader is held to none of this and can put
whoever they like on.

## Setting it up

1. **`rota-config.json`.** Set the club's name and the wording of the
   training. The calendar here is only the starting one: once the coordinator
   saves the calendar on the roster page it is kept in the store and this file
   is no longer read for nights or events.

       { "club": { "name": "Ballyvaughan Foroige Club" },
         "training": { "label": "Building training", "short": "Building" },
         "settings": { "sections": [
           { "key": "club", "name": "Club night",
             "time": "7:30 to 9:00 pm", "venue": "The Hall",
             "dates": ["2026-10-07", "2026-10-14"] } ] },
         "events": [
           { "date": "2026-10-30", "title": "Halloween disco",
             "location": "The Hall" } ] }

   `label` is the full name of the training and `short` is what fits on a
   badge. `key` must match `^[a-z0-9-]{1,32}$`. Add an `endDate` to anything
   running more than a day.

   **Club nights come from `dates`, or from `day`, or from both.** `dates` is
   a list of confirmed dates. `day` is a weekday name instead ("Wednesday"),
   and fills the next eight weeks by itself. Past dates drop off on their own.

   **Club nights and events are not the same thing here.** Anything in
   `dates` is a club night, in the building, and carries the training
   requirement. Anything in `events` is an event and does not. That is the
   only difference between them, so put a night in the building in `dates`
   even if it is a one-off.

## The calendar, once it is running

The coordinator keeps it on the roster page, under Calendar. Each night has
a kind (club night or event), a date, a name, somewhere to be, a line of
description that shows on the rota under the heading, and how many leaders it
needs if that is not the usual number. Events also take a last day, for
anything running more than one.

**Called off** greys a night out on the rota rather than removing it, so
whoever was already down for it keeps their place if it comes back.

The first time the page is opened the calendar is filled in from
`rota-config.json`, ready to save. Saving takes it over: from then on the
file is ignored and everything is edited here. Nothing is written until Save
is pressed, so a half-typed date is never stored.

**Renaming or moving a night keeps everyone already down for it.** Each entry
carries an id that the ticks hang off, not its date and name, so a club night
that shifts a week does not quietly lose its leaders. Removing an entry does
remove its ticks, and the page says so before it does.

   More than one club or age group: add more entries to `sections`, each with
   its own `key`. The rota grows a row of chips to switch between them and
   the coordinator gets a tick box per club against each person. With one
   club none of that appears and everyone on the roster covers it.

2. **The admin password.** No password is baked into the code. Set
   `ADMIN_PASSWORD` in Netlify's environment variables, **scoped to
   Functions**, and redeploy. A variable scoped to Builds only is invisible
   to the function and looks exactly like not setting it, which is the
   commonest way to lose an afternoon here. Without it, first-time setup
   answers 503 and says so.

3. **First run.** Open `roster.html`, expand "First time setting this up?",
   enter a name and that password. That creates the coordinator and shows
   their code. Everything after that happens on the roster page and the
   password is not needed again.

4. **The leaders.** On the roster page, "Add a list of names at once" takes
   the whole list pasted in, one name per line, with a `*` on the end of the
   line for anyone who holds the training. Numbering and bullets are
   stripped, so a list copied out of a document works as it stands. Everyone
   gets a code, all shown together, once.

## Deploying

Netlify, publishing this repo. `netlify.toml` already sets the functions
directory, noindexes the whole site, and points the bare address at the
rota. Blobs needs no setup; it is on for every site. The only thing to add
by hand is `ADMIN_PASSWORD`, scoped to Functions.

Confirm the function is up before handing it to anyone: `OPTIONS` on
`/.netlify/functions/foroige` returns 204, and a `GET` with no token returns
401 with `{"error":"Please sign in."}`. A 401 rather than a 500 proves the
store is reachable, because the function reads or creates its secret before
it checks anything.

## Working on it

    npm install
    npm run build:function    # netlify/src -> netlify/functions
    npm run test:function     # 109 offline cases
    npm run serve             # http://127.0.0.1:8899/rota.html

The preview runs the real function against an in-memory store that lasts
only as long as the process, with `local` as the admin password. The file
under `netlify/functions/` is generated: never edit it, edit
`netlify/src/foroige.mjs`, rebuild, and commit the two together.

## This repo is public

The site is private in the only way that matters, behind personal codes, but
the repo is not. Nothing here should ever carry a name, a code, a phone
number or the admin password. The lists live in the store, put there through
the roster page. Reverting a commit does not unpublish anything already
fetched or indexed, so it is worth a second look before pushing.
