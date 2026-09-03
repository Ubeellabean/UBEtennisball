# Ledger — grade & GPA tracker

A small, static website for tracking grades class-by-class and seeing how
they roll up into your GPA. No build step, no backend — it's three files
(`index.html`, `styles.css`, `app.js`) that run entirely in the browser and
save your data to `localStorage`.

## What it does

- **One entry per class**, each with:
  - Credits (used to weight the overall GPA)
  - A **GPA weight bonus** — e.g. set an AP or honors class to `+1.0` or
    `+0.5` and that gets added on top of its unweighted GPA points.
  - **Grading categories** you define yourself, each with its own weight —
    e.g. Homework 10%, Labs 30%, Tests 60%. The app warns you if a class's
    category weights don't add up to 100%.
  - **Assignments inside each category** (score / possible points). The
    category average is the average of each assignment's percent; the class
    grade is the weighted average of category averages, using only the
    categories that currently have at least one assignment (so a class with
    no test scores yet still shows a sensible in-progress grade).
- **A GPA scale you can edit** (Settings → "Edit GPA scale"), mapping percent
  cutoffs to letter grades and GPA points. Ships with a standard 4.0 table.
- **"What score do I need?"** per class — pick a category and a target grade
  (as a percent, a letter like `A-`, or `3.7 gpa`), and it solves for the
  average you need in that category, assuming every other category stays
  where it is now.
- **"What GPA do I need?"** overall — pick a target overall GPA and one class
  to "solve for," and it works out the weighted GPA (and roughly what percent
  grade) that class needs to carry, given your other classes' credits and
  grades.
- A running **transcript table** and a GPA seal in the header, both live.

## Running it locally

No install needed — just open `index.html` in a browser. If your browser
blocks local file scripts, serve it with any static server, e.g.:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Putting it on GitHub

```bash
git init
git add .
git commit -m "Initial commit: grade ledger"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then turn on GitHub Pages:

1. On GitHub, open the repo → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Set **Branch** to `main` and folder to `/ (root)`, then **Save**.
4. After a minute, your site is live at
   `https://<your-username>.github.io/<repo-name>/`.

## Notes and assumptions

- Data is stored only in your browser (`localStorage`), scoped to the exact
  URL you use. That means data won't follow you between, say, a local file
  and the GitHub Pages URL, or between browsers/devices. There's no account
  system or syncing — this is meant to be a personal, local tool.
- A category's average is the **average of assignment percentages**, not a
  raw points-earned-over-points-possible sum. If you want points-based
  weighting instead, that's a small change in `categoryAverage()` in
  `app.js`.
- The goal calculators assume everything *other* than the thing you're
  solving for stays fixed at its current value — they're a planning aid, not
  a guarantee.
