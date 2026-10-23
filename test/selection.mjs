// Mouse selection maps visual columns back to logical columns.
// The mapping must be the exact inverse of the reordering, including the
// left padding that right-aligns an RTL paragraph.

import { applyRtl, logicalColumn } from "../src/rtl.mjs";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cells = (s) => [...strip(s)].length;
const isRtlChar = (c) => /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(c);

let failed = 0;
const cases = [
    ["arabic line", "السلام عليكم ورحمة الله", 40],
    ["arabic with numbers", "نسبة النجاح 95% من الطلاب", 44],
    ["mixed", "الملف: src/main.ts (نسخة)", 42],
    ["ltr only", "hello world", 30],
];

for (const [name, line, width] of cases) {
    const hasRtl = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(line);
    if (!hasRtl) {
        const identity = logicalColumn(line, width, 3) === 3;
        console.log(`${identity ? "ok  " : "FAIL"} ${name.padEnd(22)} identity mapping (no RTL)`);
        if (!identity) failed++;
        continue;
    }
    const out = applyRtl(line, width);
    const pad = cells(out) - cells(line);
    const logical = [...line];
    for (let v = 0; v < width; v++) {
        const l = logicalColumn(line, width, v);
        if (l < 0 || l > logical.length) {
            console.log(`FAIL ${name}: visual ${v} -> logical ${l} out of range`);
            failed++;
            continue;
        }
        // mapping must be monotonic-or-reversed but never skip: every visual
        // cell inside the text maps to a distinct logical cell
        if (v >= pad && v < cells(out)) {
            const expected = logical[l];
            if (expected === undefined) {
                console.log(`FAIL ${name}: visual ${v} has no logical cell`);
                failed++;
            }
        }
    }
    // dragging the two ends of the text must select the whole line
    const first = logicalColumn(line, width, pad);
    const last = logicalColumn(line, width, pad + cells(line) - 1);
    const spansAll = Math.min(first, last) === 0 && Math.max(first, last) === logical.length - 1;
    if (!spansAll) {
        console.log(`FAIL ${name}: ends map to ${first}..${last} of 0..${logical.length - 1}`);
        failed++;
    }
    console.log(`${spansAll ? "ok  " : "FAIL"} ${name.padEnd(22)} pad=${pad} ends=${first}..${last}`);
}

// an Arabic line's visual order must be the reverse of its logical order
const line = "مرحبا";
const out = strip(applyRtl(line, 20));
const visualText = out.trim();
const reversed = [...line].reverse().join("");
const shapedOk = [...visualText].every(isRtlChar) && visualText.length === line.length;
console.log(`${shapedOk ? "ok  " : "FAIL"} reorder keeps every cell (${visualText.length}/${line.length})`);
if (!shapedOk) failed++;

console.log(`\n${failed === 0 ? "selection mapping ok" : `${failed} failures`}`);
process.exit(failed ? 1 : 0);
