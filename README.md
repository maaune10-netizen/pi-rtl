# pi-rtl — العربية في pi

عرض صحيح للعربية (اتجاه + تشكيل الحروف) داخل [pi](https://pi.dev) على أي طرفية،
بدون الحاجة إلى طرفية تدعم BiDi أو Arabic shaping.

![pi with Arabic](docs/screenshot.png)

## المشكلة

`pi` ترسل النص كـ UTF-8 خام + ANSI، ولا تطبق خوارزمية الاتجاه (UAX #9) ولا
تشكيل الحروف العربية. أغلب الطرفيات كذلك: Windows Terminal، mintty/Git Bash،
Kitty، Alacritty، Ghostty، iTerm2. النتيجة:

```
ابحرم            ← المفروض: مرحبا
م ر ح ب ا        ← حروف مقطّعة
12 ... %         ← علامة النسبة منفصلة عن الرقم
```

## الحل

سطر واحد يُعدّل في renderer الخاص بـ pi: النص يُحوَّل إلى ترتيب بصري + صور
الحروف المتصلة **قبل** كتابته للطرفية.

```sh
curl -fsSL https://raw.githubusercontent.com/maaune10-netizen/pi-rtl/main/install.sh | sh
```

ثم أعد تشغيل `pi`. لا اعتماديات، لا خادم، لا تغيير في النص المرسل للنموذج.

بدائل:

```sh
# عبر npx (npm أقل من 12)
npx -y github:maaune10-netizen/pi-rtl
# npm 12 يمنع حزم git افتراضياً، فأضف العلم
npx -y --allow-git=all github:maaune10-netizen/pi-rtl

# أو استنسخ يدوياً
git clone https://github.com/maaune10-netizen/pi-rtl
cd pi-rtl
node bin/pi-rtl.mjs            # تطبيق
node bin/pi-rtl.mjs --check    # الحالة
node bin/pi-rtl.mjs --undo     # رجوع
```

### الخط مهم

المخرج يستخدم صور الحروف العربية (U+FB50–FDFF، U+FE70–FEFF). لازم الخط يحتويها:

* ✅ DejaVu Sans Mono، Segoe UI، Arial، Tahoma، Noto Naskh Arabic
* ❌ Consolas، JetBrains Mono، Fira Code، Menlo → مربعات `□`

على ويندوز: إعدادات الطرفية ← الخط. في mintty: `Options → Text → Font`.

## English

Correct Arabic/Persian/Hebrew rendering (bidi reordering + contextual shaping)
inside [pi](https://pi.dev), on terminals that have neither.

```sh
curl -fsSL https://raw.githubusercontent.com/maaune10-netizen/pi-rtl/main/install.sh | sh
```

Restart pi afterwards. Re-run it after every `pi update` (a new release replaces
the bundle).

Alternatives:

```sh
npx -y github:maaune10-netizen/pi-rtl                  # npm < 12
npx -y --allow-git=all github:maaune10-netizen/pi-rtl  # npm 12 blocks git deps by default
git clone https://github.com/maaune10-netizen/pi-rtl && cd pi-rtl && node bin/pi-rtl.mjs
```

### How it works

The renderer composes each output line and writes it to stdout. This patch
intercepts that single call site:

```
normalizeTerminalOutput(line)+reset
  -> __piRtl(normalizeTerminalOutput(line),this.terminal.columns)+reset
```

`rtl.mjs` then:

1. splits the line into per-code-point cells and records the SGR state of each,
2. runs the Unicode Bidirectional Algorithm
   ([`bidi-shaper`](https://github.com/cc1a2b/bidi-shaper), verified against all
   861,948 official UAX #9 conformance cases) per segment,
3. converts Arabic letters to their presentation forms (joining),
4. permutes the cells into visual order — a pure permutation, so the cell count
   is unchanged and every width/wrap/diff calculation in pi keeps working,
5. re-emits the SGR changes at the new positions (colors and hyperlinks survive),
6. treats box-drawing characters and `|` as hard bidi boundaries, like mlterm's
   `bidi_separators`, so tables and borders never flip,
7. flushes RTL paragraphs to the right margin, which also puts the caret on the
   correct side while typing Arabic.

Paragraph direction is decided **per segment**: Arabic-first segments resolve
RTL (like mlterm and macOS Terminal), English-first segments stay LTR. Lines
without RTL characters take a regex fast path and are untouched.

### Tests

```sh
node test/run.mjs      # 132 cases, oracle = bidi-shaper.render()
```

The oracle is the conformance-tested library applied with the same segment
split, so a failure points at this project's reordering code, not at the UBA
implementation.

### Uninstall

```sh
node bin/pi-rtl.mjs --undo
rm -rf "$HOME/.pi/agent/install/releases/*/node_modules/@earendil-works/pi-coding-agent/dist/bundle/pi-rtl"
```

### Known gaps

* Right alignment is skipped on lines with wide characters (CJK, emoji) because
  pi's `wcwidth` is not available inside the transform.
* `لا` is drawn as lam-initial + alef-final instead of the single ligature, to
  keep the cell count stable.
* A path right after an Arabic word can lose its leading `/` to the RTL run
  (`الملف: home/user/x`). That is what UAX #9 specifies; mlterm deviates.
  Splitting on `/` would break `و/أو`.
* Combining marks stay attached to their base (cluster-level reversal).
* Only the standalone pi install (`dist/bundle`) is supported. If pi is loaded
  from `node_modules`, the installer exits with an error instead of pretending.

## Credits

* [`bidi-shaper`](https://github.com/cc1a2b/bidi-shaper) — MIT, vendored in
  `src/vendor/bidi-shaper/` (UAX #9 + Arabic shaping, zero dependencies).
* Prior art: [mlterm](https://github.com/arakiken/mlterm) for the separator
  behaviour, and the freedesktop
  [BiDi in Terminal Emulators](https://terminal-wg.pages.freedesktop.org/bidi)
  spec.

## License

MIT
