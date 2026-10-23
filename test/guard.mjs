// Verifies the environment guards in src/rtl.mjs by running a child process per
// case, because the guard is evaluated at module load.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rtl = join(here, "..", "src", "rtl.mjs");

const probe = `
import { applyRtl } from ${JSON.stringify(rtl)};
process.stdout.write(applyRtl("مرحبا", 20));
`;

const cases = [
    ["default", {}, true],
    ["PI_RTL=0", { PI_RTL: "0" }, false],
    ["PI_RTL=off", { PI_RTL: "off" }, false],
    ["Apple_Terminal", { TERM_PROGRAM: "Apple_Terminal" }, false],
    ["Konsole", { KONSOLE_VERSION: "240800" }, false],
    ["mlterm", { TERM: "mlterm" }, false],
    ["Apple_Terminal + PI_RTL=1", { TERM_PROGRAM: "Apple_Terminal", PI_RTL: "1" }, true],
    ["iTerm2", { TERM_PROGRAM: "iTerm.app" }, true],
    ["Windows Terminal", { WT_SESSION: "abc" }, true],
];

let failed = 0;
for (const [name, env, expectPatched] of cases) {
    const clean = { PATH: process.env.PATH, HOME: process.env.HOME };
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
        env: { ...clean, ...env },
        encoding: "utf8",
    });
    const out = result.stdout ?? "";
    const patched = out !== "مرحبا";
    const ok = patched === expectPatched && result.status === 0;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(26)} patched=${patched} expected=${expectPatched}`);
    if (!ok && result.stderr) console.log(result.stderr.trim());
}

console.log(`\n${cases.length - failed}/${cases.length} guard cases passed`);
process.exit(failed ? 1 : 0);
