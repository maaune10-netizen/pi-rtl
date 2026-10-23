// Compares applyRtl() against the conformance-tested bidi-shaper pipeline.
// Oracle = split the line at bidi separators, then render() each segment with
// the same options we use. Any diff therefore points at a bug in our own
// reordering/segmenting code, not at the UBA implementation.
//
//   node test/run.mjs            # summary + mismatch details
//   node test/run.mjs -v         # also print every case

import { applyRtl } from "../src/rtl.mjs";
import { render } from "../src/vendor/bidi-shaper/index.js";
import corpus, { alignCases } from "./corpus.mjs";

const OPTS = {
    direction: process.env.PI_RTL_DIRECTION === "ltr" ? "ltr" : "auto",
    shape: true,
    ligatures: false,
    tashkeel: "keep",
    mirror: true,
    paragraphs: "single",
};
const SEP_RE = /([\u2500-\u257f|])/u;

function oracle(line) {
    if (!SEP_RE.test(line)) return render(line, OPTS);
    const parts = line.split(SEP_RE);
    let out = "";
    for (let i = 0; i < parts.length; i++) out += i % 2 === 1 ? parts[i] : render(parts[i], OPTS);
    return out;
}

const verbose = process.argv.includes("-v");
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;.*?\x1b\\/g, "");
const MARKS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u08d3-\u08ff\ufe20-\ufe2f]/g;
const noMarks = (s) => s.replace(MARKS, "");
const cells = (s) => [...stripAnsi(s)].length;

let pass = 0;
const failures = [];
const info = [];

for (const [id, input, meta = {}] of corpus) {
    const got = applyRtl(input);
    const plainIn = stripAnsi(input);
    const want = oracle(plainIn);
    const same = noMarks(stripAnsi(got)) === noMarks(want);
    const widthOk = cells(input) === cells(got);

    if (!widthOk) failures.push({ id, input, got, want, kind: "width", cellsIn: cells(input), cellsOut: cells(got) });
    else if (!same && meta.strict !== false) failures.push({ id, input, got, want, kind: "diff" });
    else if (!same) info.push({ id, input, got, want });
    else pass++;

    if (verbose) console.log(same ? "ok  " : "DIFF", id.padEnd(22), JSON.stringify(input), "=>", JSON.stringify(got));
}

// width-aware alignment cases: compare against pad + oracle
const { detectDirection } = await import("../src/vendor/bidi-shaper/index.js");
for (const [id, input, width] of alignCases) {
    const got = applyRtl(input, width);
    const plain = stripAnsi(input);
    const body = oracle(plain);
    const rtl = detectDirection(plain) === "rtl";
    const pad = rtl && !SEP_RE.test(plain) ? Math.max(0, width - cells(plain)) : 0;
    const want = " ".repeat(pad) + body;
    if (got === want) pass++;
    else failures.push({ id, input, got, want, kind: "align" });
}

console.log(`\n${pass} passed, ${failures.length} failed, ${info.length} known-divergence (marks), ${corpus.length + alignCases.length} total`);
const widthFails = failures.filter((f) => f.kind === "width");
if (widthFails.length) {
    console.log("\n== WIDTH CHANGED (breaks pi layout) ==");
    for (const f of widthFails) console.log(`${f.id}: ${f.cellsIn} -> ${f.cellsOut}\n  in : ${JSON.stringify(f.input)}`);
}
const diffs = failures.filter((f) => f.kind === "diff");
if (diffs.length) {
    console.log("\n== WRONG VISUAL ORDER ==");
    for (const f of diffs) {
        console.log(`${f.id}\n  in  : ${JSON.stringify(f.input)}\n  got : ${JSON.stringify(f.got)}\n  want: ${JSON.stringify(f.want)}`);
    }
}
const aligns = failures.filter((f) => f.kind === "align");
if (aligns.length) {
    console.log("\n== ALIGNMENT ==");
    for (const f of aligns) console.log(`${f.id}\n  in  : ${JSON.stringify(f.input)}\n  got : ${JSON.stringify(f.got)}\n  want: ${JSON.stringify(f.want)}`);
}
if (info.length && verbose) {
    console.log("\n== known divergences (marks) ==");
    for (const f of info) console.log(`${f.id}\n  got : ${JSON.stringify(f.got)}\n  want: ${JSON.stringify(f.want)}`);
}
process.exit(failures.length ? 1 : 0);
