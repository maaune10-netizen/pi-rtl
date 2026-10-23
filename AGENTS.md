# AGENTS.md

Instructions for an AI agent working in this repository.

## What this is

`pi-rtl` makes the [pi](https://pi.dev) coding agent render Arabic (and other
RTL scripts) correctly on terminals that implement neither the Unicode
Bidirectional Algorithm nor Arabic shaping — Windows Terminal, mintty/Git Bash,
Kitty, Alacritty, Ghostty, iTerm2.

It is **not** a pi extension. The extension API has no hook for the renderer, so
this project patches one expression in pi's bundled TUI and ships the
replacement transform alongside it.

## The patch

Exactly one expression changes in `<pi-bundle>/chunks/chunk-*.js`:

```
normalizeTerminalOutput(line)+reset
  -> __piRtl(normalizeTerminalOutput(line),this.terminal.columns)+reset
```

plus one ESM import at the top of that chunk:

```js
import{applyRtl as __piRtl}from"../pi-rtl/rtl.mjs";
```

`src/rtl.mjs` and `src/vendor/bidi-shaper/` are copied to `<pi-bundle>/pi-rtl/`.
`src/install.mjs` implements apply / undo / check and is idempotent; it upgrades
older patch shapes in place.

## Invariants — do not break these

1. **Cell count is preserved.** `applyRtl` must never change the number of
   terminal cells. Entering the UBA at the wrong position, or enabling lam-alef
   ligatures, both violate this.
2. **ANSI is preserved.** SGR state is tracked per cell and re-emitted at the new
   positions. Never strip colour, OSC 8 hyperlinks, or reset sequences.
3. **One call site.** Do not add a second transform pass. Everything that is
   printed flows through `applyLineResets`.
4. **Separators split runs.** `│`-style box drawing and `|` are hard bidi
   boundaries. Removing this collapses tables and TUI borders.
5. **Direction is per segment, never forced.** Do not "fix" a case by forcing
   `direction: "ltr"` — that breaks percent signs, label/path order and right
   alignment all at once (this exact regression happened once).
6. **No new dependencies.** `bidi-shaper` is vendored on purpose; it is the only
   engine, and it is what the tests compare against.

## Testing

```sh
node test/run.mjs        # 132 ordering/alignment cases; non-zero on failure
node test/guard.mjs      # 9 environment-guard cases
npm test                 # both
node test/run.mjs -v     # print every case
```

The oracle is `bidi-shaper.render()` with the same segment split, so a failure
means this project's reordering or segmentation is wrong.

When you change behaviour, add cases to `test/corpus.mjs`:

* `[id, input]` — compared strictly against the oracle.
* `[id, input, { strict: false }]` — for intentional divergence (combining marks
  stay attached to their base instead of being reversed per code point).
* `alignCases` — `[id, input, width]` for right-alignment expectations.

## Regenerating the README screenshot

`docs/demo-session.jsonl` is a synthetic session (user question plus one
assistant reply with a table, a code block and a list — no real paths, keys or
provider data). To rebuild the image:

```sh
cd <some empty dir>
pi --session <repo>/docs/demo-session.jsonl --offline
# screenshot the window, then crop it to the window geometry
```

Render it in `xterm`, not `mlterm`: mlterm shapes Arabic itself and would hide
regressions. If the assistant message lacks `api`/`model` fields pi crashes in
`addUsageToTotals`, so keep the shape of the entry as it is.

## Verifying on a machine

```sh
node bin/pi-rtl.mjs --check          # patched / unpatched / patched-v1
node bin/pi-rtl.mjs --undo           # always works, plain string replacement
```

Headless verification without a GUI (this is how the project was validated):

```sh
# capture the real ANSI stream pi writes
PI_TUI_WRITE_LOG=/tmp/tui-ansi.log pi --session <session.jsonl> --offline
# replay it into a virtual terminal, then transform and compare
npm i @xterm/headless
```

To prove the renderer works on a terminal with **no** bidi and **no** shaping,
run it under `xterm` (not `mlterm`) — `xterm` is the honest stand-in for
Windows Terminal. `mlterm` renders Arabic natively and will hide regressions.

## Debugging

| Symptom | Cause |
|---|---|
| `12 ... %` separated | base direction forced to LTR somewhere |
| table columns flipped | separator split removed, or direction forced to RTL |
| `□` boxes | the terminal font lacks U+FB50–FDFF / U+FE70–FEFF — not a code bug |
| `لا` looks like two glyphs | expected: ligatures are disabled to keep cell count |
| patch "succeeds" but nothing changes | pi is loaded from `node_modules`, not `dist/bundle` |
| patch stops applying after `pi update` | expected: a new release replaces the bundle, re-run the installer |

Env knobs: `PI_RTL=0` disables the transform, `PI_RTL=1` forces it even on a
terminal that does its own bidi, `PI_RTL_DIRECTION=ltr` disables RTL paragraph
detection, `PI_MANAGED_INSTALL_ROOT` overrides the install root,
`PI_TUI_WRITE_LOG` dumps pi's raw output.

The auto-stand-down list (Apple Terminal, Konsole, mlterm) exists because
transforming text that the terminal will reorder again produces garbage.
`test/guard.mjs` covers it; add a case there whenever the list grows.

## Known gaps (do not silently "fix")

* Wide characters (CJK, emoji) skip right alignment — pi's `wcwidth` is not
  reachable from the transform.
* A leading `/` in a path right after an Arabic word joins the RTL run. This is
  conformant UAX #9; splitting on `/` breaks `و/أو`.
* Combining marks are reversed at cluster level, so output differs from a naive
  per-code-point UBA pass (intentionally).

## Style

* ESM only, no build step, no TypeScript.
* Every file that the installer copies must work as plain Node ESM from
  `<pi-bundle>/pi-rtl/` with relative imports.
* Keep the runtime under ~10 KB excluding the vendored engine.
