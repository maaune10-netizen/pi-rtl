#!/usr/bin/env node
import { apply, undo, check, bundleDirs } from "../src/install.mjs";

const USAGE = `pi-rtl — Arabic/RTL rendering for the pi coding agent

Usage:
  pi-rtl                 apply the patch (idempotent)
  pi-rtl --check         show patch state
  pi-rtl --undo          revert to the stock renderer
  pi-rtl --help          this message

Notes:
  - Restart pi after applying or reverting.
  - Re-run \`pi-rtl\` after every \`pi update\`; a new release replaces the bundle.
  - Your terminal font must contain Arabic presentation forms (U+FB50-FDFF,
    U+FE70-FEFF): DejaVu Sans Mono, Segoe UI, Arial, Tahoma, Noto Naskh Arabic.
    Consolas, JetBrains Mono, Fira Code and Menlo do not.`;

const arg = process.argv[2];
const has = (...names) => names.includes(arg);

if (has("--help", "-h")) {
    console.log(USAGE);
    process.exit(0);
}

if (has("--check")) {
    const rows = check();
    if (rows.length === 0) {
        console.error("pi-rtl: no pi bundle found");
        process.exit(1);
    }
    for (const row of rows) console.log(`[${row.state}] ${row.file}`);
    process.exit(0);
}

if (has("--undo")) {
    const result = undo();
    if (result.changed.length === 0) console.log("pi-rtl: nothing to undo");
    else console.log(`pi-rtl: reverted ${result.changed.join(", ")} — restart pi`);
    process.exit(0);
}

const result = apply();
if (!result.ok) {
    console.error(`pi-rtl: ${result.error}`);
    process.exit(1);
}
if (result.alreadyPatched) console.log("pi-rtl: already patched");
else console.log(`pi-rtl: patched ${result.changed.join(", ")} — restart pi`);
for (const dir of bundleDirs()) console.log(`  bundle: ${dir}`);
