# pi-rtl

عرض صحيح للعربية والفارسية والأردية والعبرية داخل [pi](https://pi.dev) — على أي
طرفية، حتى اللي ما تدعم لا خوارزمية الاتجاه ولا تشكيل الحروف: Windows Terminal،
mintty/Git Bash، Kitty، Alacritty، Ghostty، iTerm2.

العربية · [English](README.md)

![pi يعرض رداً عربياً فيه جدول وشيفرة وقائمة](docs/screenshot.png)

## المشكلة

`pi` ترسل نص UTF-8 مع أنماط ANSI وتترك التنسيق للطرفية. هي لا تطبق خوارزمية
الاتجاه من يونيكود (UAX #9) ولا تشكّل الحروف العربية، وأغلب الطرفيات كذلك.
النتيجة:

```
ابحرم            بدل  مرحبا
م ر ح ب ا        حروف مقطّعة
12 ... %         علامة النسبة منفصلة عن رقمها
```

## التثبيت

```sh
curl -fsSL https://raw.githubusercontent.com/maaune10-netizen/pi-rtl/main/install.sh | sh
```

ثم أعد تشغيل `pi`. أعد الأمر نفسه بعد كل `pi update` — الإصدار الجديد يستبدل
ملفات `pi`.

طرق أخرى:

```sh
npx -y github:maaune10-netizen/pi-rtl                  # npm أقل من 12
npx -y --allow-git=all github:maaune10-netizen/pi-rtl  # npm 12 يمنع حزم git افتراضياً

git clone https://github.com/maaune10-netizen/pi-rtl
cd pi-rtl
node bin/pi-rtl.mjs            # تطبيق
node bin/pi-rtl.mjs --check    # الحالة
node bin/pi-rtl.mjs --undo     # رجوع
```

لا اعتماديات، لا خادم، لا وسيط. النص المرسل للنموذج لا يتغير إطلاقاً — التغيير
فيما يصل إلى شاشتك فقط.

### الخط مهم

المخرج يستخدم صور الحروف العربية (U+FB50–FDFF، U+FE70–FEFF)، فلازم خط الطرفية
يحتويها:

* ✅ DejaVu Sans Mono، Segoe UI، Arial، Tahoma، Noto Naskh Arabic
* ❌ Consolas، JetBrains Mono، Fira Code، Menlo ← تعطيك مربعات `□`

في Windows Terminal: الإعدادات ← المظهر ← الخط.
في mintty / Git Bash: `Options → Text → Font`.

## أين لا نحتاجها

بعض الطرفيات تطبق الاتجاه وتشكيل الحروف بنفسها. تمرير نص مُرتَّب بصرياً إليها
يعيد ترتيبه مرة ثانية، لذلك يتوقف الـpatch تلقائياً في:

| الطرفية | كيف تُعرَف |
|---|---|
| طرفية macOS (Terminal.app) | `TERM_PROGRAM=Apple_Terminal` |
| Konsole | `KONSOLE_VERSION` |
| mlterm | `TERM=mlterm…` |

وفي غيرها يعمل: Windows Terminal، mintty/Git Bash، iTerm2، Kitty، Alacritty،
Ghostty، GNOME Terminal، xterm. وتقدر تفرض الحالتين:

```sh
PI_RTL=0 pi   # لا تحويل إطلاقاً (مثلاً Terminal على macOS عبر SSH)
PI_RTL=1 pi   # حوّل دائماً حتى على طرفية تدعم الاتجاه
```

`TERM_PROGRAM` لا يُنقل عبر SSH افتراضياً، فجلسة SSH تبدأ من طرفية macOS تبدو
كطرفية عادية وسيُحوَّل نصها. لو ظهر النص مقلوباً مرتين هناك، استخدم `PI_RTL=0`.

## كيف يعمل

`pi` تركّب كل سطر إخراج ثم تكتبه. الـpatch يعترض ذلك الموضع الوحيد:

```
normalizeTerminalOutput(line)+reset
  -> __piRtl(normalizeTerminalOutput(line),this.terminal.columns)+reset
```

بعدها `rtl.mjs` — لكل سطر فيه محارف RTL:

1. يفكّك السطر إلى خلايا (code point لكل خلية) ويسجل حالة SGR لكل خلية، فتبقى
   الألوان وروابط OSC 8 سليمة بعد التبديل،
2. يشغّل خوارزمية الاتجاه من يونيكود
   ([`bidi-shaper`](https://github.com/cc1a2b/bidi-shaper)، متحقَّق منها ضد كل
   ٨٦١,٩٤٨ حالة اختبار رسمية)،
3. يحوّل الحروف العربية إلى صورها المتصلة (تشكيل)،
4. يعيد ترتيب الخلايا بصرياً — **تبديل خلايا لا أكثر**، فعدد الخلايا لا يتغير
   وحسابات العرض والالتفاف والطبقات والرسم التفاضلي في pi تبقى كما هي،
5. يعيد إصدار تغييرات SGR في المواضع الجديدة،
6. يعامل محارف رسم الصناديق و`|` كحدود اتجاه صلبة، كما تفعل
   `bidi_separators` في mlterm، فلا تنقلب الجداول ولا إطارات الواجهة،
7. يدفع الفقرات العربية إلى الهامش الأيمن، وهذا يضبط موضع المؤشر أيضاً أثناء
   الكتابة العربية.

اتجاه الفقرة يُحدَّد **لكل مقطع** لا لكل سطر: المقطع الذي يبدأ بعربي يصير RTL
(مثل mlterm وطرفية macOS)، والذي يبدأ بإنجليزي يبقى LTR. الأسطر الخالية من
العربية تمرّ عبر مسار سريع وتُعاد كما هي حرفياً.

## الاختبارات

```sh
node test/run.mjs        # ١٣٢ حالة
node test/run.mjs -v     # طباعة كل حالة
```

المرجع هو `bidi-shaper.render()` بنفس تقسيم المقاطع، فأي فشل يشير إلى كود
الترتيب في هذا المشروع لا إلى تنفيذ الخوارزمية. التغطية: الترتيب، الأرقام
والنسب، الأقواس والاقتباسات، الجداول، أنماط ANSI، المحاذاة، التشكيل، اللغات
المختلطة، وأسطر pi الحقيقية.

## الإزالة

```sh
node bin/pi-rtl.mjs --undo
```

استبدال نصّي بسيط يرجع المرسّم الأصلي؛ الـpatch لا يترك حالة في أي مكان آخر.

## قصور معروف

* المحاذاة اليمنى تُتخطّى في الأسطر التي فيها محارف عريضة (CJK، إيموجي) لأن
  `wcwidth` الخاص بـ pi غير متاح من داخل المحوّل.
* `لا` تُرسم كـ(لام أولية + ألف نهائية) بدل الـligature الواحد، للحفاظ على عدد
  الخلايا.
* المسار الملاصق لكلمة عربية قد يفقد `/` الأولى لصالح مقطع الـRTL
  (`الملف: home/user/x`). هذا ما ينص عليه المعيار لشرطة محايدة بين مقطع عربي
  ومقطع لاتيني، وmlterm يخالفه. التقسيم على `/` كان سيكسر `و/أو`.
* الحركات تبقى ملتصقة بحروفها (عكس على مستوى الـcluster)، وهذا يختلف عمداً عن
  تمرير ساذج على مستوى الـcode point.
* ندعم تثبيت pi المستقل (`dist/bundle`) فقط. لو كان pi يعمل من `node_modules`
  فالمثبّت يقول ذلك ويتوقف، بدل أن يدّعي النجاح.

## شكر

* [`bidi-shaper`](https://github.com/cc1a2b/bidi-shaper) — MIT، مضمّن في
  `src/vendor/bidi-shaper/`: خوارزمية UAX #9 مع تشكيل العربية، بلا اعتماديات.
* [mlterm](https://github.com/arakiken/mlterm) لفكرة فواصل الاتجاه.
* مسودة [BiDi in Terminal Emulators](https://terminal-wg.pages.freedesktop.org/bidi)
  من freedesktop لتأطير المشكلة.

## الترخيص

MIT
