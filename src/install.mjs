// Installer core for pi-rtl.
//
// The patch touches exactly one expression in pi's bundled renderer:
//
//     normalizeTerminalOutput(line)+reset
//   -> __piRtl(normalizeTerminalOutput(line),this.terminal.columns)+reset
//
// plus one ESM import for the transform module that is copied next to the
// bundle. Nothing else is modified, which is why `--undo` is a plain string
// replacement and why a patch from an older version can be upgraded in place.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = "pi-rtl";

export const TARGET = "normalizeTerminalOutput(line)+reset";
export const PATCHED = "__piRtl(normalizeTerminalOutput(line),this.terminal.columns)+reset";
export const PATCHED_V1 = "__piRtl(normalizeTerminalOutput(line))+reset";
export const IMPORT_LINE = 'import{applyRtl as __piRtl}from"../pi-rtl/rtl.mjs";\n';
export const IMPORT_RE = /^import\{applyRtl as __piRtl\}from"\.\.\/pi-rtl\/rtl\.mjs";\n/m;

export function bundleDirs() {
    const root = process.env.PI_MANAGED_INSTALL_ROOT ?? join(homedir(), ".pi", "agent", "install");
    const found = [];
    const currentFile = join(root, "current-version");
    if (existsSync(currentFile)) {
        const version = readFileSync(currentFile, "utf8").trim();
        if (version) found.push(join(root, "releases", version, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle"));
    }
    if (found.length === 0) {
        const releases = join(root, "releases");
        if (existsSync(releases)) {
            for (const version of readdirSync(releases).sort()) {
                found.push(join(releases, version, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle"));
            }
        }
    }
    return found.filter((dir) => existsSync(dir) && existsSync(join(dir, "chunks")));
}

function installRuntime(bundleDir) {
    const dst = join(bundleDir, RUNTIME_DIR);
    mkdirSync(join(dst, "vendor", "bidi-shaper"), { recursive: true });
    copyFileSync(join(SRC_DIR, "rtl.mjs"), join(dst, "rtl.mjs"));
    for (const file of ["index.js", "package.json", "LICENSE"]) {
        copyFileSync(join(SRC_DIR, "vendor", "bidi-shaper", file), join(dst, "vendor", "bidi-shaper", file));
    }
    return dst;
}

function chunkFiles(bundleDir) {
    return readdirSync(join(bundleDir, "chunks")).filter((f) => f.endsWith(".js"));
}

export function check() {
    const bundles = bundleDirs();
    const rows = [];
    for (const bundleDir of bundles) {
        for (const file of chunkFiles(bundleDir)) {
            const source = readFileSync(join(bundleDir, "chunks", file), "utf8");
            const state = source.includes(PATCHED) ? "patched"
                : source.includes(PATCHED_V1) ? "patched-v1"
                : source.includes(TARGET) ? "unpatched"
                : null;
            if (state) rows.push({ bundleDir, file, state });
        }
    }
    return rows;
}

export function apply() {
    const bundles = bundleDirs();
    if (bundles.length === 0) {
        return { ok: false, error: "could not find a pi bundle. Only the standalone pi install (dist/bundle) is supported." };
    }
    const changed = [];
    for (const bundleDir of bundles) {
        installRuntime(bundleDir);
        for (const file of chunkFiles(bundleDir)) {
            const path = join(bundleDir, "chunks", file);
            const source = readFileSync(path, "utf8");
            const hasImport = IMPORT_RE.test(source);
            const hasPatched = source.includes(PATCHED);
            const hasV1 = source.includes(PATCHED_V1);
            const hasTarget = source.includes(TARGET);
            if (!hasTarget && !hasPatched && !hasV1) continue;
            if (hasPatched && hasImport) continue;

            let next = source;
            if (!hasImport) next = IMPORT_LINE + next;
            if (hasV1) next = next.split(PATCHED_V1).join(PATCHED);
            if (hasTarget) next = next.split(TARGET).join(PATCHED);
            if (next === source) continue;
            writeFileSync(path, next, "utf8");
            changed.push(file);
        }
    }
    if (changed.length === 0 && check().every((r) => r.state === "patched")) {
        return { ok: true, changed: [], alreadyPatched: true };
    }
    if (changed.length === 0) {
        return { ok: false, error: "found the bundle but not the patch target. pi internals probably changed; open an issue with your pi version." };
    }
    return { ok: true, changed };
}

export function undo() {
    const changed = [];
    for (const bundleDir of bundleDirs()) {
        for (const file of chunkFiles(bundleDir)) {
            const path = join(bundleDir, "chunks", file);
            const source = readFileSync(path, "utf8");
            if (!source.includes(PATCHED) && !source.includes(PATCHED_V1) && !IMPORT_RE.test(source)) continue;
            let next = source;
            next = next.split(PATCHED).join(TARGET);
            next = next.split(PATCHED_V1).join(TARGET);
            next = next.replace(IMPORT_RE, "");
            if (next === source) continue;
            writeFileSync(path, next, "utf8");
            changed.push(file);
        }
    }
    return { ok: true, changed };
}
