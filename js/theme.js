/* Theme presets and CSS-variable application.
 *
 * Loaded synchronously in <head> so the saved theme is applied before first
 * paint (no flash of the default colours). A theme is four user colours;
 * borders, muted text and contrast colours are derived from them so any
 * combination stays readable.
 */
(function (root) {
    const STT = root.STT = root.STT || {};

    const PRESETS = {
        purple: { name: 'Default Purple', background: '#0d0019', card: '#240046', accent: '#9d4edd', text: '#f0e1ff' },
        light:  { name: 'Light',  background: '#f2f1f6', card: '#ffffff', accent: '#6d3fd6', text: '#1d1b24' },
        dark:   { name: 'Dark',   background: '#121214', card: '#1f1f24', accent: '#8b7cf6', text: '#ececf1' },
        blue:   { name: 'Blue',   background: '#0a1628', card: '#132640', accent: '#3b8cf6', text: '#e2ecff' },
        green:  { name: 'Green',  background: '#0a1a11', card: '#15301f', accent: '#2fbf6a', text: '#e3f5ea' },
        amoled: { name: 'AMOLED', background: '#000000', card: '#0d0d0d', accent: '#bb86fc', text: '#ffffff' }
    };
    const DEFAULT_PRESET = 'purple';

    // Day status bars. Kept separately from the palette so they survive preset changes.
    const DEFAULT_STATUS = { planned: '#3b8cf6', missed: '#ef4444', under: '#f5b301', complete: '#22c55e' };
    const STATUS_VARS = { planned: '--plan', missed: '--bad', under: '--warn', complete: '--ok' };

    // Colours of the untouched theme in versions <= 4.6 (key names of that era).
    const LEGACY_DEFAULT = { '--text-color': '#e0aaff', '--card-bg-color': '#240046', '--border-color': '#5a189a', '--background-color': '#000000' };

    const HEX_RE = /^#[0-9a-f]{6}$/i;
    const isHex = v => typeof v === 'string' && HEX_RE.test(v);

    function hexToRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbToHex(rgb) {
        return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    }
    function mix(a, b, t) {
        const A = hexToRgb(a), B = hexToRgb(b);
        return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
    }
    function luminance(hex) {
        const c = hexToRgb(hex).map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrast(a, b) {
        const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
    }
    const onColor = bg => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

    /** The palette: four colours plus an optional outline colour (custom themes only). */
    function colorsFor(theme) {
        if (theme && theme.preset && theme.preset !== 'custom' && PRESETS[theme.preset]) {
            const p = PRESETS[theme.preset];
            return { background: p.background, card: p.card, accent: p.accent, text: p.text };
        }
        const c = (theme && theme.colors) || {};
        const base = PRESETS[DEFAULT_PRESET];
        const out = {
            background: isHex(c.background) ? c.background : base.background,
            card: isHex(c.card) ? c.card : base.card,
            accent: isHex(c.accent) ? c.accent : base.accent,
            text: isHex(c.text) ? c.text : base.text
        };
        if (isHex(c.border)) out.border = c.border;
        return out;
    }

    function statusFor(theme) {
        const s = (theme && theme.status) || {};
        const out = {};
        for (const k in DEFAULT_STATUS) out[k] = isHex(s[k]) ? s[k] : DEFAULT_STATUS[k];
        return out;
    }

    /** Outline colour actually used: the chosen one, or one derived from cards and text. */
    function derivedBorder(c, text, isLight) {
        return mix(c.card, text, isLight ? 0.16 : 0.2);
    }

    /** CSS custom properties derived from the four theme colours. */
    function cssVars(theme) {
        const c = colorsFor(theme);
        const isLight = luminance(c.background) > 0.4;
        // Keep text readable even if a user picks text close to the card colour.
        const text = contrast(c.text, c.card) >= 4.5 ? c.text : onColor(c.card);
        const vars = {
            '--bg': c.background,
            '--surface': c.card,
            '--surface-2': mix(c.card, text, isLight ? 0.05 : 0.07),
            '--border': c.border || derivedBorder(c, text, isLight),
            '--text': text,
            '--text-muted': mix(text, c.card, 0.38),
            '--text-faint': mix(text, c.card, 0.62),
            '--accent': c.accent,
            '--accent-soft': mix(c.card, c.accent, 0.28),
            '--on-accent': onColor(c.accent),
            '--track': mix(c.background, text, isLight ? 0.1 : 0.12),
            '--scheme': isLight ? 'light' : 'dark'
        };
        const status = statusFor(theme);
        for (const k in STATUS_VARS) vars[STATUS_VARS[k]] = status[k];
        return vars;
    }

    /** The outline colour currently in effect (for showing in the picker). */
    function effectiveBorder(theme) {
        return cssVars(theme)['--border'];
    }

    function apply(theme, doc = root.document) {
        if (!doc) return;
        const vars = cssVars(theme);
        const style = doc.documentElement.style;
        for (const k in vars) if (k !== '--scheme') style.setProperty(k, vars[k]);
        style.colorScheme = vars['--scheme'];
        const meta = doc.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', vars['--bg']);
    }

    /** Converts the pre-5.0 customTheme object into the current theme shape. */
    function fromLegacy(custom) {
        if (!custom || typeof custom !== 'object') return { preset: DEFAULT_PRESET };
        const same = Object.keys(LEGACY_DEFAULT).every(k => String(custom[k] || '').toLowerCase() === LEGACY_DEFAULT[k]);
        if (same) return { preset: DEFAULT_PRESET };
        const pick = (k, fallback) => (isHex(custom[k]) ? custom[k] : fallback);
        return {
            preset: 'custom',
            colors: {
                background: pick('--background-color', LEGACY_DEFAULT['--background-color']),
                card: pick('--card-bg-color', LEGACY_DEFAULT['--card-bg-color']),
                // The old "outline" colour was used for outlines and buttons alike.
                accent: pick('--border-color', LEGACY_DEFAULT['--border-color']),
                border: pick('--border-color', LEGACY_DEFAULT['--border-color']),
                text: pick('--text-color', LEGACY_DEFAULT['--text-color'])
            }
        };
    }

    STT.theme = { PRESETS, DEFAULT_PRESET, DEFAULT_STATUS, isHex, colorsFor, statusFor, cssVars, effectiveBorder, apply, fromLegacy, contrast };

    // Pre-paint: apply whatever is saved (current or legacy format).
    try {
        if (root.document && root.localStorage) {
            const s = JSON.parse(root.localStorage.getItem('serviceTimeTrackerSettings') || 'null');
            apply(s && s.theme ? s.theme : fromLegacy(s && s.customTheme));
        }
    } catch (e) { /* the app re-applies the theme after loading settings */ }
})(typeof self !== 'undefined' ? self : globalThis);
