// Arabic/RTL display layer for pi-tui.
//
// Runs at the very last stage, on a fully composed output line (text + SGR),
// and returns the same line permuted into visual order with Arabic letters in
// their presentation forms. Permutation keeps the cell count identical, so all
// of pi's width/wrap/diff math stays valid.

import { analyze, shape } from "./vendor/bidi-shaper/index.js";

const RTL_RE = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;

const MARK_RE = /\p{M}/u;

const MIRROR = new Map([
    ["(", ")"], [")", "("], ["[", "]"], ["]", "["], ["{", "}"], ["}", "{"],
    ["<", ">"], [">", "<"], ["\u00ab", "\u00bb"], ["\u00bb", "\u00ab"],
    ["\u2039", "\u203a"], ["\u203a", "\u2039"],
]);

const attrKey = (p) => {
    switch (p) {
        case 1: return "bold";
        case 2: return "faint";
        case 3: return "italic";
        case 4: return "underline";
        case 5: case 6: return "blink";
        case 7: return "reverse";
        case 8: return "conceal";
        case 9: return "strike";
        default: return `sgr${p}`;
    }
};

function applySgr(attrs, params) {
    if (params.length === 0) params = [0];
    for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p === 0) { attrs.clear(); continue; }
        if (p === 38 || p === 48) {
            const kind = p === 38 ? "fg" : "bg";
            if (params[i + 1] === 5) { attrs.set(kind, [p, 5, params[i + 2]]); i += 2; continue; }
            if (params[i + 1] === 2) { attrs.set(kind, [p, 2, params[i + 2], params[i + 3], params[i + 4]]); i += 4; continue; }
            continue;
        }
        if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) { attrs.set("fg", [p]); continue; }
        if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) { attrs.set("bg", [p]); continue; }
        if (p === 39) { attrs.delete("fg"); continue; }
        if (p === 49) { attrs.delete("bg"); continue; }
        if (p >= 22 && p <= 29) {
            const drop = { 22: ["bold", "faint"], 23: ["italic"], 24: ["underline"], 25: ["blink"], 27: ["reverse"], 28: ["conceal"], 29: ["strike"] }[p];
            if (drop) { for (const k of drop) attrs.delete(k); continue; }
        }
        attrs.set(attrKey(p), [p]);
    }
}

function serialize(attrs) {
    if (attrs.size === 0) return "";
    const out = [];
    for (const v of attrs.values()) out.push(...v);
    return `\x1b[${out.join(";")}m`;
}

// Split a composed line into per-code-point cells and the SGR state of each.
function tokenize(line) {
    const chars = [];
    const styles = [];
    const attrs = new Map();
    let pending = "";
    let i = 0;
    while (i < line.length) {
        const c = line.charCodeAt(i);
        if (c === 0x1b) {
            // CSI ... m  |  OSC ... BEL/ST  |  other
            const next = line.charCodeAt(i + 1);
            if (next === 0x5b) { // '['
                let j = i + 2;
                while (j < line.length) {
                    const cc = line.charCodeAt(j);
                    if (cc >= 0x40 && cc <= 0x7e) break;
                    j++;
                }
                const final = line[j];
                const body = line.slice(i + 2, j);
                if (final === "m") {
                    applySgr(attrs, body.length === 0 ? [] : body.split(";").map((x) => (x === "" ? 0 : Number(x))));
                }
                i = j + 1;
                continue;
            }
            if (next === 0x5d) { // ']' OSC
                let j = i + 2;
                while (j < line.length && line.charCodeAt(j) !== 0x07 && !(line.charCodeAt(j) === 0x1b && line.charCodeAt(j + 1) === 0x5c)) j++;
                const end = line.charCodeAt(j) === 0x07 ? j + 1 : j + 2;
                const seq = line.slice(i, end);
                if (seq.startsWith("\x1b]8;")) {
                    // hyperlink: keep as part of the style stream
                    pending += seq;
                }
                i = end;
                continue;
            }
            i += 2;
            continue;
        }
        const cp = line.codePointAt(i);
        const len = cp > 0xffff ? 2 : 1;
        chars.push(line.slice(i, i + len));
        styles.push(pending + serialize(attrs));
        pending = "";
        i += len;
    }
    return { chars, styles };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// "auto" resolves to the first strong character per segment: Arabic-first lines
// become RTL paragraphs (like mlterm/macOS Terminal), English-first lines stay
// LTR. Tables are protected by the separator split, not by forcing LTR.
const BASE_DIR = process.env.PI_RTL_DIRECTION === "ltr" ? "ltr" : "auto";

// Some terminals already do bidi and Arabic shaping themselves. Feeding them
// visual-order presentation forms would reorder the text a second time, so the
// patch stands down there. PI_RTL=1 overrides, PI_RTL=0 disables everywhere.
const PI_RTL_ENV = (process.env.PI_RTL ?? "").toLowerCase();
const RTL_DISABLED = ["0", "off", "false", "no"].includes(PI_RTL_ENV);
const RTL_FORCED = ["1", "on", "true", "yes", "force"].includes(PI_RTL_ENV);
const NATIVE_BIDI_TERMINAL = (() => {
    if (RTL_FORCED) return false;
    if ((process.env.TERM_PROGRAM ?? "") === "Apple_Terminal") return true; // macOS Terminal.app
    if (process.env.KONSOLE_VERSION) return true;                          // Konsole
    if ((process.env.TERM ?? "").startsWith("mlterm")) return true;        // mlterm
    return false;
})();

function clusterize(text) {
    // Intl.Segmenter reports UTF-16 offsets; everything else here works in
    // code point space, so translate (surrogate pairs would otherwise drift).
    const cpOfUtf16 = new Map();
    let u16 = 0;
    let cp = 0;
    for (const ch of text) {
        cpOfUtf16.set(u16, cp);
        u16 += ch.length;
        cp++;
    }
    const clusters = [];
    for (const { segment, index } of segmenter.segment(text)) {
        clusters.push({ start: cpOfUtf16.get(index) ?? 0, len: [...segment].length });
    }
    return clusters;
}

const cache = new Map();
const CACHE_MAX = 4000;

export function applyRtl(line, width) {
    if (RTL_DISABLED || NATIVE_BIDI_TERMINAL) return line;
    if (typeof line !== "string" || line.length === 0) return line;
    if (!RTL_RE.test(line)) return line;

    const key = width ? `${width}\u0000${line}` : line;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const out = transform(line, width);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
}

// Box-drawing and pipes act as hard bidi boundaries, like mlterm's
// `bidi_separators`. Without this, table borders and gutters get swept into the
// RTL run and the grid collapses.
const SEP_RE = /([\u2500-\u257f|])/u;

// Characters whose terminal cell width is not 1. Right padding is skipped for
// those lines because we would need pi's full wcwidth to stay aligned.
const WIDE_RE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{1f000}-\u{1faff}]|[\u{2600}-\u{27bf}]/u;

function transform(line, width) {
    if (!SEP_RE.test(line)) {
        const r = transformSegment(line);
        if (typeof r === "string") return r;
        // A paragraph that resolves RTL is flushed right, like every Arabic UI.
        if (width && r.direction === "rtl" && !WIDE_RE.test(line)) {
            // leave the last column free: a line that fills the terminal exactly
            // would auto-wrap and shift everything by one row
            const pad = width - 1 - r.cells;
            if (pad > 0) return " ".repeat(pad) + r.text;
        }
        return r.text;
    }
    const parts = line.split(SEP_RE);
    let out = "";
    for (let i = 0; i < parts.length; i++) {
        const r = i % 2 === 1 ? parts[i] : transformSegment(parts[i]);
        out += typeof r === "string" ? r : r.text;
    }
    return out;
}

function transformSegment(line) {
    const { chars, styles } = tokenize(line);
    if (chars.length === 0) return line;

    const logical = chars.join("");
    const shaped = shape(logical, { ligatures: false, tashkeel: "keep" });
    const shapedChars = [...shaped];
    // 1:1 mapping is what makes the whole approach safe.
    if (shapedChars.length !== chars.length) return line;

    const { levels, direction } = analyze(shaped, {
        direction: BASE_DIR,
        shape: false,
        mirror: false,
        ligatures: false,
        tashkeel: "keep",
        paragraphs: "single",
    });

    const clusters = clusterize(shaped);
    const clusterLevel = [];
    for (let idx = 0; idx < clusters.length; idx++) {
        const c = clusters[idx];
        let lvl = levels[c.start] ?? 0;
        let markOnly = c.len > 0;
        for (let k = 0; k < c.len; k++) {
            if (!MARK_RE.test(shapedChars[c.start + k])) { markOnly = false; break; }
        }
        if (markOnly && idx > 0) lvl = clusterLevel[idx - 1] ?? 0;
        clusterLevel.push(lvl);
    }

    const order = clusters.map((_, idx) => idx);
    const maxLevel = clusterLevel.reduce((a, b) => Math.max(a, b), 0);
    const minOdd = clusterLevel.reduce((a, b) => (b % 2 === 1 ? Math.min(a, b) : a), 99);
    if (minOdd !== 99) {
        for (let lvl = maxLevel; lvl >= minOdd; lvl--) {
            let i = 0;
            while (i < order.length) {
                if (clusterLevel[order[i]] >= lvl) {
                    let j = i;
                    while (j < order.length && clusterLevel[order[j]] >= lvl) j++;
                    for (let a = i, b = j - 1; a < b; a++, b--) {
                        const t = order[a]; order[a] = order[b]; order[b] = t;
                    }
                    i = j;
                } else i++;
            }
        }
    }

    let out = "";
    let curStyle = null;
    for (const ci of order) {
        const cluster = clusters[ci];
        const rtl = (clusterLevel[ci] & 1) === 1;
        for (let k = 0; k < cluster.len; k++) {
            const li = cluster.start + k;
            let ch = shapedChars[li];
            if (rtl) {
                const m = MIRROR.get(ch);
                if (m) ch = m;
            }
            const st = styles[li] ?? "";
            if (st !== curStyle) {
                if (curStyle !== null && curStyle !== "") out += "\x1b[0m";
                out += st;
                curStyle = st;
            }
            out += ch;
        }
    }
    if (curStyle) out += "\x1b[0m";
    return { text: out, direction, cells: shapedChars.length };
}
