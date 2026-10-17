import { kioskTokens as k, adminTokens as a } from '@proctor/ui';
import type { CSSProperties } from 'react';

/**
 * Kiosk global stylesheet, injected once.
 *
 * Design constraints, all of them consequences of the primary rule that a candidate
 * must never have to read:
 *  * Every interactive target is at least 96 px on its shortest side.
 *  * Focus rings are thick and high contrast, because touch users also use keyboards
 *    and because a visible focus state is an accessibility requirement.
 *  * Motion is decorative only. Every state is also distinguishable by icon, label and
 *    shape, so nothing depends on animation — or on colour — to be understood.
 *  * `user-select: none` prevents a candidate from accidentally selecting and dragging
 *    captions instead of pressing a button.
 */
export const kioskStyles = `
:root {
  --k-bg: ${k.color.bg};
  --k-surface: ${k.color.surface};
  --k-ink: ${k.color.ink};
  --k-ink-soft: ${k.color.inkSoft};
  --k-primary: ${k.color.primary};
  --k-listening: ${k.color.listening};
  --k-speaking: ${k.color.speaking};
  --k-thinking: ${k.color.thinking};
  --k-error: ${k.color.error};
  --k-touch: ${k.touchTarget}px;
  --k-glass: rgba(255, 255, 255, 0.30);
  --k-glass-strong: rgba(255, 255, 255, 0.48);
  --k-glass-border: rgba(255, 255, 255, 0.6);
  --k-glass-shadow: 0 12px 36px rgba(2, 12, 27, 0.22);
  --k-glass-blur: blur(24px) saturate(170%);
}

* { box-sizing: border-box; }

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}

/**
 * The Ramco Mills photograph fills the screen, kept vivid under a light scrim so the frosted
 * glass panels read as translucent. A fixed attachment holds the picture still as screens change.
 */
body {
  background-color: ${k.color.bg};
  background-image:
    linear-gradient(160deg, rgba(255, 255, 255, 0.10), rgba(6, 20, 34, 0.26)),
    url('/ramco-mills-bg.png');
  background-position: center center;
  background-size: cover;
  background-repeat: no-repeat;
  background-attachment: fixed;
  color: var(--k-ink);
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, 'Noto Sans', 'Noto Sans Devanagari', sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
  /* A kiosk is a fixed appliance: no accidental text selection, no pull-to-refresh,
     no pinch-zoom, no long-press callout. */
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  overflow: hidden;
}

.k-screen {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.k-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 40px 32px;
  text-align: center;
}

.k-display {
  font-size: ${k.type.display};
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
  max-width: 20ch;
}

.k-question {
  font-size: ${k.type.question};
  line-height: 1.22;
  font-weight: 700;
  margin: 0;
  max-width: 26ch;
}

.k-body {
  font-size: ${k.type.body};
  line-height: 1.5;
  color: var(--k-ink-soft);
  margin: 0;
  max-width: 40ch;
}

.k-caption {
  font-size: ${k.type.caption};
  color: var(--k-ink-soft);
  margin: 0;
  max-width: 44ch;
}

/* ---------- Buttons ---------- */

.k-btn {
  min-height: var(--k-touch);
  min-width: var(--k-touch);
  padding: 20px 40px;
  border-radius: ${k.radius.md};
  border: none;
  font-size: clamp(1.25rem, 2.2vw, 1.75rem);
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  transition: transform ${k.duration.fast}ms ease, box-shadow ${k.duration.fast}ms ease, background ${k.duration.fast}ms ease;
}

.k-btn:active { transform: scale(0.97); }
.k-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.k-btn-primary {
  background: var(--k-primary);
  color: ${k.color.primaryInk};
  box-shadow: 0 10px 30px rgba(11, 61, 107, 0.28);
}

.k-btn-secondary {
  background: var(--k-glass);
  backdrop-filter: var(--k-glass-blur);
  -webkit-backdrop-filter: var(--k-glass-blur);
  border: 3px solid var(--k-primary);
  color: var(--k-primary);
  box-shadow: var(--k-glass-shadow);
}

.k-btn-ghost {
  background: transparent;
  color: var(--k-primary);
  border: 3px solid transparent;
}

.k-btn-danger {
  background: var(--k-color-error, ${k.color.error});
  color: #fff;
}

.k-btn-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

/* ---------- The microphone orb ---------- */

.k-orb {
  position: relative;
  width: clamp(200px, 26vw, 300px);
  height: clamp(200px, 26vw, 300px);
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: none;
  cursor: pointer;
  color: #fff;
  transition: background ${k.duration.base}ms ease;
}

.k-orb-listening { background: var(--k-listening); box-shadow: 0 0 0 12px ${k.color.listeningSoft}; }
.k-orb-speaking  { background: var(--k-speaking);  box-shadow: 0 0 0 12px ${k.color.speakingSoft}; }
.k-orb-thinking { background: var(--k-thinking); box-shadow: 0 0 0 12px ${k.color.thinkingSoft}; }
.k-orb-error     { background: var(--k-error);     box-shadow: 0 0 0 12px ${k.color.errorSoft}; }
.k-orb-muted      { background: ${a.color.textMuted}; box-shadow: 0 0 0 12px ${a.color.surfaceAlt}; }

.k-orb-ring {
  position: absolute;
  inset: -14px;
  border-radius: 50%;
  border: 4px solid currentColor;
  opacity: 0;
}

.k-orb-listening .k-orb-ring { animation: k-pulse 1.9s ease-out infinite; border-color: var(--k-listening); }
.k-orb-speaking  .k-orb-ring { animation: k-pulse 1.2s ease-out infinite; border-color: var(--k-speaking); }
.k-orb-thinking  .k-orb-ring { animation: k-pulse 2.6s ease-in-out infinite; border-color: var(--k-thinking); }

/* Live audio level, drawn as a subtle inner glow sized from the analyser. */
.k-orb-level {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 68%);
  transform: scale(var(--level, 1));
  transition: transform 90ms linear;
  pointer-events: none;
}

/* ---------- State banner ---------- */

.k-state {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 14px 28px;
  border-radius: ${k.radius.pill};
  font-size: clamp(1.05rem, 1.9vw, 1.4rem);
  font-weight: 700;
  background: var(--k-glass-strong);
  backdrop-filter: var(--k-glass-blur);
  -webkit-backdrop-filter: var(--k-glass-blur);
  border: 3px solid transparent;
}

.k-state-listening { color: var(--k-listening); border-color: var(--k-listening); background: rgba(226, 244, 238, 0.85); }
.k-state-speaking  { color: var(--k-speaking);  border-color: var(--k-speaking);  background: rgba(253, 238, 221, 0.85); }
.k-state-thinking { color: var(--k-thinking); border-color: var(--k-thinking); background: rgba(236, 233, 250, 0.85); }
.k-state-error     { color: var(--k-error);     border-color: var(--k-error);     background: rgba(251, 233, 231, 0.85); }
.k-state-offline   { color: ${k.color.offline};  border-color: ${k.color.offline}; background: rgba(253, 240, 221, 0.85); }

/* ---------- Progress ---------- */

.k-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.k-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 4px solid ${k.color.progressTodo};
  background: transparent;
  transition: background ${k.duration.base}ms ease, border-color ${k.duration.base}ms ease;
}

.k-dot--done {
  background: ${k.color.progressDone};
  border-color: ${k.color.progressDone};
}

.k-dot--current {
  border-color: var(--k-primary);
  background: var(--k-primary);
  animation: k-breathe 1.8s ease-in-out infinite;
}

.k-progress-label {
  font-size: clamp(1rem, 1.7vw, 1.3rem);
  font-weight: 700;
  color: var(--k-ink-soft);
  margin-left: 10px;
}

/* ---------- Choice cards (language / job) ---------- */

.k-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
  width: 100%;
  max-width: 1100px;
}

.k-choice {
  min-height: var(--k-touch);
  padding: 26px 24px;
  border-radius: ${k.radius.md};
  background: var(--k-glass);
  backdrop-filter: var(--k-glass-blur);
  -webkit-backdrop-filter: var(--k-glass-blur);
  border: 4px solid var(--k-glass-border);
  box-shadow: var(--k-glass-shadow);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-family: inherit;
  color: var(--k-ink);
  transition: transform ${k.duration.fast}ms ease, border-color ${k.duration.fast}ms ease;
}

.k-choice:hover { border-color: var(--k-primary); transform: translateY(-2px); }
.k-choice--selected { border-color: var(--k-primary); background: rgba(232, 240, 250, 0.6); }
.k-choice-native { font-size: clamp(1.6rem, 3vw, 2.2rem); font-weight: 800; }
.k-choice-name { font-size: clamp(1rem, 1.5vw, 1.15rem); color: var(--k-ink-soft); }
.k-choice-title { font-size: clamp(1.4rem, 2.4vw, 1.9rem); font-weight: 800; }
.k-choice-meta { font-size: clamp(0.95rem, 1.4vw, 1.1rem); color: var(--k-ink-soft); }

/* ---------- Top bar ---------- */

.k-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 28px;
  background: var(--k-glass);
  backdrop-filter: var(--k-glass-blur);
  -webkit-backdrop-filter: var(--k-glass-blur);
  border-bottom: 1px solid var(--k-glass-border);
  min-height: 84px;
}

.k-topbar-title { font-size: clamp(1.1rem, 1.8vw, 1.4rem); font-weight: 800; }
.k-topbar-sub { font-size: clamp(0.85rem, 1.2vw, 1rem); color: var(--k-ink-soft); }
.k-iconbtn {
  min-width: var(--k-touch);
  min-height: var(--k-touch);
  border-radius: ${k.radius.md};
  border: 1px solid var(--k-glass-border);
  background: var(--k-glass);
  backdrop-filter: var(--k-glass-blur);
  -webkit-backdrop-filter: var(--k-glass-blur);
  color: var(--k-primary);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.k-iconbtn--active { border-color: var(--k-primary); background: rgba(255, 255, 255, 0.7); }
.k-iconbtn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ---------- Misc ---------- */

.k-card {
  background: var(--k-glass-strong);
  backdrop-filter: var(--k-glass-blur);
  -webkit-backdrop-filter: var(--k-glass-blur);
  border: 1px solid var(--k-glass-border);
  border-radius: ${k.radius.md};
  padding: 28px;
  box-shadow: var(--k-glass-shadow);
  max-width: 900px;
  width: 100%;
}

.k-transcript {
  background: var(--k-glass-strong);
  backdrop-filter: var(--k-glass-blur);
  -webkit-backdrop-filter: var(--k-glass-blur);
  border-left: 8px solid var(--k-primary);
  border-radius: ${k.radius.sm};
  padding: 16px 20px;
  font-size: clamp(1rem, 1.6vw, 1.25rem);
  color: var(--k-ink-soft);
  text-align: left;
  max-width: 900px;
  width: 100%;
}

.k-transcript:empty { display: none; }

.k-demo {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 60;
  padding: 8px 16px;
  border-radius: ${k.radius.pill};
  background: ${a.color.warningSoft};
  color: ${a.color.warning};
  border: 2px solid ${a.color.warning};
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  pointer-events: none;
}

.k-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes k-pulse {
  0% { transform: scale(0.9); opacity: 0.65; }
  70% { transform: scale(1.28); opacity: 0; }
  100% { transform: scale(1.28); opacity: 0; }
}

@keyframes k-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); }
}

/* Respect the kiosk setting and the OS preference equally. */
.k-reduced-motion *,
.k-reduced-motion *::before,
.k-reduced-motion *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}

:focus-visible {
  outline: 5px solid ${k.color.primary};
  outline-offset: 4px;
  border-radius: ${k.radius.sm};
}

@media (max-height: 700px) {
  .k-center { gap: 18px; padding: 24px; }
  .k-orb { width: clamp(150px, 20vw, 200px); height: clamp(150px, 20vw, 200px); }
}
`;

export const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};
