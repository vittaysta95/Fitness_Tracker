# VfIT — Vitthuran's Fitness Tracker (static, build-free version)

This is a **no-Python, no-Node-build-step** version of the fitness tracker.
Everything runs in the browser: voice input, exercise matching, trend
charts, weekly summaries, Garmin CSV import, all of it. No server, no
`pip install`, no `npm install`.

## The trade-off, stated plainly

The full version (FastAPI + SQLite) needed Python to run. This version
keeps every feature but stores data in **IndexedDB inside one browser**
instead. That means:

- ✅ No install step, no `npm install`, no build tooling — just host the
  files as-is (see hosting instructions below; note that *opening the
  HTML file directly* does not work, for reasons explained below)
- ✅ Same voice input, dropsets, trend charts, weekly summary + share, CSV export
- ✅ Manual Garmin CSV upload still works exactly the same way
- ❌ Data lives in **one browser on one device** — no multi-device sync,
  no server backup. CSV export is your backup mechanism.
- ❌ The "import full exercise dataset" button in Settings needs an
  internet connection (it fetches from GitHub) — everything else works
  fully offline once the page has loaded once.

If you later want multi-device sync, that needs a real backend again —
worth revisiting once Python/Node tooling is available to you, or via a
hosted backend service.

## Important: you need to host this somewhere, not just open the file

This app uses JavaScript modules (`import`/`export`), which Chrome and
other browsers block from running when opened directly as a local file
(`file://...`) — this is a browser security rule, unrelated to anything
in this codebase, and affects every site built this way. You'll see a
CORS error in the console and a blank page if you try.

**The fix: host it somewhere, even a free static host.** GitHub Pages is
the easiest path and matches your Harbourline setup.

## Running it via GitHub Pages (recommended path)

```bash
git init
git add .
git commit -m "Fitness tracker"
git remote add origin https://github.com/yourusername/your-repo.git
git push -u origin main
```

Then in the repo's Settings → Pages, set the source to your main branch,
root folder. Your app will be live at
`https://yourusername.github.io/your-repo/` within a minute or two.
This also gives you the full PWA install experience (full-screen on
Android) since GitHub Pages serves over HTTPS — `file://` never would
have given you that even if it worked.

## Other static hosts (if you'd rather not use GitHub Pages)

Netlify, Vercel, and Cloudflare Pages all support dragging a folder
straight into their dashboard with no git/CLI needed — this is plain
static files, so any of them will work identically to GitHub Pages.

## Installing on Android (full-screen PWA)

1. Host it somewhere over HTTPS (GitHub Pages, above)
2. Open the URL in Chrome on your Android phone
3. Chrome will offer "Add to Home Screen" — or use the ⋮ menu
4. Launches full-screen, no browser chrome, exactly like the original spec

## Project structure

```
fitness-app-static/
├── index.html          entry point, no build step needed
├── app.js               wires up router + nav + service worker
├── style.css            same design tokens as the React version
├── manifest.json        PWA manifest (full-screen, Android)
├── sw.js                service worker for offline app-shell caching
├── icon-192.png, icon-512.png, icon.svg
└── src/
    ├── db.js                  IndexedDB data layer (replaces SQLite)
    ├── router.js              tiny hash-based router (replaces React Router)
    ├── icons.js               inline SVG icons (replaces lucide-react)
    ├── exerciseMatching.js    fuzzy exercise name matching
    ├── voiceParser.js         voice transcript → structured set
    ├── garminImport.js        Garmin CSV parsing
    ├── trends.js              trend + weekly summary calculations
    ├── csvExport.js           CSV generation + download
    ├── exerciseSeed.js        starter exercise library (43 exercises)
    ├── dateUtils.js           timezone-safe date handling
    └── pages/
        ├── today.js, log.js, trends.js, history.js,
        └── weeklySummary.js, settings.js
```

## What's different from the Python version, technically

- **No React** — this uses small hand-written render functions that
  return HTML strings, plus a tiny router. No JSX, no build step.
- **No Recharts** — trend charts are hand-drawn SVG, generated directly
  in JS. Same visual style, no library.
- **No lucide-react** — icons are inline SVG strings in `src/icons.js`.
- **Exercise matching** uses a bigram similarity score (Dice coefficient)
  instead of Python's `difflib`. Tested against the same cases — matches
  correctly in almost every case, and is actually slightly *more*
  accurate on one equipment-confusion case that tripped up the Python
  version. One known regression: phrases with extra trailing words
  (e.g. "pull up bodyweight") score slightly lower than they did in
  Python — still resolves correctly via manual exercise selection in
  the confirm step, just doesn't auto-match as often.

## Cardio tracking

Cardio exercises (Running, Cycling, Rowing, Swimming, Elliptical, Stair
Climber, Walking — all under the "Cardio" body part) are measured in
**distance (km) and duration (minutes)**, not weight × reps. The app
detects this automatically based on the selected exercise's body part:

- Voice/manual entry shows distance and duration fields instead of
  weight/reps/RPE when a cardio exercise is matched or selected
- Cardio sets contribute **0 kg** to strength volume totals (so your
  lifting volume isn't artificially diluted by a run), but their
  distance/time are tracked and totalled separately — visible on the
  Weekly Summary page as a dedicated "Cardio this week" card
- Trend charts for a cardio exercise show Distance/Duration over time
  instead of Max Weight/Max Reps
- CSV export includes `distance_km` and `duration_min` columns
  alongside the strength columns — cardio rows leave weight/reps
  blank, strength rows leave distance/duration blank

If the app's starter exercise list grows in the future (e.g. more
cardio exercises get added), use **Settings → "Sync new starter
exercises"** to pull in anything new without touching your existing
exercises or their aliases — the automatic seeding only ever runs once,
on a completely empty database.

## Dropsets in one voice entry

You can now say a full dropset sequence in a single voice entry instead
of doing two separate entries and ticking the dropset checkbox by hand.
Say the word **"dropset"** or **"drop set"** anywhere in the phrase,
followed by two (or more) weight/reps pairs:

> "Dropset bench press, thirty kilos five reps first set, twenty kilos
> four reps second set"

This produces a draft with **multiple editable rows** — the first is
the working set, every row after that is pre-checked as a dropset and
will save linked to the working set (same as if you'd entered them
separately and ticked the box). Every row stays fully editable before
you save, so a misheard number or a wrongly-detected dropset is just a
tap to fix, not a re-recording.

A few things worth knowing:
- **Spelled-out numbers work** ("thirty," "ninety-five") — the parser
  converts these to digits before extracting weight/reps, since speech
  recognition often produces words instead of digits for round numbers.
- If "dropset" is mentioned but only one weight/reps pair is found,
  it falls back to a normal single-set entry rather than guessing.
- RPE, if spoken, is assumed to describe the working set only.
- This only applies to strength exercises — there's no such thing as
  a cardio dropset, so cardio entries are unaffected.

## Voice pickup improvements (free)

Two changes here, both free — no paid speech API involved:

**Multiple transcription candidates.** The browser's speech recognizer
now returns up to 5 candidate transcriptions per phrase instead of
just 1 (`maxAlternatives`). If the top guess doesn't match any known
exercise, the app automatically checks the other candidates and uses
whichever one actually resolves to a real exercise — so a single
mis-heard word doesn't sink the whole entry if a lower-ranked
alternative got it right.

**What this can't fix:** genuine paid speech APIs (Google Cloud
Speech-to-Text, Azure, etc.) support custom vocabulary lists that bias
recognition toward domain-specific terms — that's the real fix for
acronym/jargon accuracy, but it costs money per request and would need
a backend to call it from. This app stays free and serverless, so it
leans on the alternatives trick above instead — it helps, but it's not
as strong as a paid, vocabulary-tuned model.

**On-device recognition (Chrome 139+).** Chrome can run speech
recognition entirely on your phone instead of sending audio to
Google's servers — same Web Speech API, just with a flag set.

**This is now fully opt-in, tap-only — never automatic.** An earlier
version checked for this automatically when you opened the Log page,
and that check was found to crash the browser tab outright on at least
one real device/browser combination (a genuine instability in this
still-experimental browser feature, not something fixable from this
app's code). It now only runs when you explicitly tap "Check for free
on-device voice recognition" on the Log page, and you'll see a warning
first, since there's no way to guarantee the check itself won't crash
the tab. If that happens, just reopen the app — nothing is lost, since
the check doesn't touch your data at all.

If the check succeeds and on-device recognition is available, you'll
see a follow-up button to download the model (one-time, you choose
when). Once installed, a small "On-device (free, offline)" label
appears under the mic button whenever it's actually active.

Two things worth knowing:
- It's Chrome's **general-purpose** on-device model, not one tuned for
  gym vocabulary — contextual biasing (the feature that would let an
  app teach it terms like exercise names) doesn't exist yet, so "RPE"
  mishearing specifically may not improve from this alone.
- If you never tap the check button, absolutely nothing changes — no
  banner beyond the initial low-key prompt, no badge, voice input
  works exactly as it always has.

## Dumbbell exercises: weight is per hand

For any exercise tagged with "Dumbbell" equipment, the weight you log
is treated as **per hand** — say or enter "30kg" for a 30kg-per-hand
dumbbell bench press, and the app doubles it to 60kg only when
calculating total volume (trend charts, weekly summaries, CSV export).
The number you see in your log always matches what you actually held.

A few exercises are held as a single weight with both hands rather
than one per hand (e.g. Russian Twist) — these are explicitly excluded
from doubling. If you find another exercise that should be excluded
(or one that's currently excluded but shouldn't be), go to **Settings
→ edit that exercise** and toggle "Logged weight is per hand" — it
only appears when the exercise's equipment field mentions "Dumbbell."

## RPE: voice-reliable alternatives

Saying "RPE" out loud doesn't always transcribe correctly — it's an
uncommon three-letter acronym, and browser speech recognition (which
runs through a general-purpose cloud model) tends to mis-hear it as
similar-sounding words rather than the literal letters. "RPE 8" still
works when it does transcribe correctly, or when typed manually, but
for more reliable voice entry, these phrasings work too:

- "effort 8" / "effort of 8" / "effort 8 out of 10"
- "difficulty 7"
- "that felt like an 8"
- "8 out of 10"

These are ordinary English phrases the speech model recognizes much
more reliably than a fitness-specific acronym.

## Decimal plate weights (voice)

Spoken decimal weights now parse correctly — useful for plate math
where a small plate (1.25kg per side) makes the total a decimal:

- "twenty seven point five kilos" → 27.5
- "twenty seven and a half kilos" → 27.5
- "one hundred and two point five kilos" → 102.5 (hundreds are
  supported too, not just numbers under 100)
- Digit form ("27.5 kilos") always worked and still does

## Exercise library: 170 exercises, attachment-differentiated

The starter library grew from 47 to 170 exercises, and — more
importantly than the count — cable/machine exercises that use a
genuinely different attachment or grip are now **separate exercises**,
not aliases of one generic entry. A rope tricep pushdown and a
straight-bar tricep pushdown train the movement differently (rope
allows hand separation and a different resistance curve) and are now
tracked as their own trend lines instead of being merged into one
"Tricep Pushdown" line that hides which specific variation is actually
progressing. This applies most heavily to triceps (5 pushdown/extension
variations) and lat pulldowns (5 grip variations), and to a lesser
extent rows, curls, and raises.

**If you already have a deployed site**, the new exercises won't
appear automatically — your existing database only seeds once, on a
completely empty install. Go to **Settings → "Sync new starter
exercises"** to pull in all the new ones without touching your
existing exercises or logged history.

**Your old generic entries** (e.g. the original "Tricep Pushdown" with
rope/straight-bar all aliased together) will still exist alongside the
new split-out versions after syncing — the sync only adds new
exercises, it doesn't know to retire old ones. If you want a clean
library going forward, manually delete the old generic entries via
Settings once you've confirmed the new ones are there. Deleting an
exercise doesn't delete or corrupt any sets you logged against it —
they'll just display as "Unknown" exercise in history/trends/CSV
export rather than disappearing, since their weight/reps/volume data
is stored on the set itself, not on the exercise record.

## Navigation: History and Trends combined, Biomarkers added

The bottom nav now has History+Trends merged into one tab (toggle
between "List" and "Trends" at the top), freeing up space for a new
**Biomarkers** tab. Old links to `/trends` still work and land on the
same combined page. Biomarkers currently tracks body weight — sleep
score and calories from Garmin are planned for later, which is why
it's named broadly rather than just "Weight."

## Body weight tracking (Biomarkers)

Log today's weight, see a trend chart once you have a few entries, and
browse history below. Logging again on a date that already has an
entry **updates it** rather than creating a duplicate — there's only
ever one weight per day. Has its own CSV export, separate from the
training data export, since the shape doesn't fit the same table.

## Search-and-autofill for exercises

Both the Log page's manual entry and the new pronunciation training
section (below) now use a live search-as-you-type dropdown instead of
typing blind and hoping the fuzzy matcher resolves it. Settings'
exercise library also got a filter box, useful now that the list has
170 exercises — type a few letters to narrow it down instead of
scrolling.

## Exercise carries forward to the next set

After logging a set manually, the next manual entry defaults to the
**same exercise** — useful since you're usually doing several sets of
one movement in a row, not switching exercises every time. Voice entry
always uses whatever was actually said; but if a voice entry doesn't
match any exercise at all, it falls back to the previous exercise
(marked "low confidence — check this") rather than leaving you to pick
from scratch, since a failed match is often background noise eating
the exercise name while the numbers came through fine.

## Teach it your pronunciation

New section in Settings: pick an exercise, say its name the way you
naturally would, and see exactly what the recognizer heard. If it's
not already saved, tap "Commit to memory as alias" to add that exact
phrase to the exercise's alias list — so voice entries for that
exercise are more likely to match correctly going forward. This is how
the matcher learns your specific pronunciation over time, on top of
the hand-picked aliases that ship with the app.

## Known limitations (carried over or new)

- **Voice input** needs Chrome (Web Speech API isn't a universal web
  standard). Same as before — fine for Android Chrome use.
- **Exercise matching** can occasionally pick the wrong equipment
  variant of a similarly-named exercise. Correct via Settings → edit
  aliases as you find mismatches — this was always the expected workflow.
- **"Hours trained"** in the weekly summary is an estimate (3.5 min/set),
  since there's no session start/end timestamp tracked.
- **Garmin CSV date parsing**: ambiguous `DD/MM/YYYY` vs `MM/DD/YYYY`
  formats are assumed to be `MM/DD/YYYY` (the common Garmin export
  default). If your export uses day-first dates and metrics look wrong
  after upload, this is the first thing to check.
- **"Import full exercise dataset"** in Settings needs internet access
  (fetches from a public GitHub-hosted dataset). Everything else is
  fully offline after first load.
- **Single browser, single device.** Clearing your browser's site data,
  using a different browser, or switching devices means starting fresh
  unless you've exported and re-imported a CSV backup (note: CSV export
  is for your records — there's currently no CSV *re-import* path back
  into the app; let me know if you want that added).

## Backing up your data

Settings → "Download all data as CSV" anytime. Since everything lives
in this one browser, treat that CSV as your actual backup — copy it
somewhere safe periodically (cloud storage, email to yourself, etc).

### Daily backup prompt

A banner appears at the top of the Today page once per day (after
you've logged anything) prompting you to back up — tap it and it
prepares the CSV and opens your phone's native share sheet so you can
send it straight to Drive, email, WhatsApp, wherever, in one motion.
If your browser doesn't support sharing files this way, it falls back
to a plain download instead.

**Why this isn't fully silent/automatic:** browsers deliberately block
any script from triggering a file share or download without you
actually tapping something first — this is a security rule (the Web
Share API throws an error if called without genuine user interaction),
not a limitation of this app specifically. A one-tap daily prompt is
the closest real equivalent to "automatic" that's actually possible
for a web app with no backend.

The banner won't reappear once you've backed up that day, and tracks
this in the same local browser storage as everything else — so it
resets if you clear site data, same as your training history would.
