import{r as Ee,a as nt}from"./react-BdZgHC1P.js";import{A as rt,S as ot,c as st,a as at,i as ve,t as xe,b as it,d as ct}from"./speech-Bz2JQwxW.js";(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))a(s);new MutationObserver(s=>{for(const d of s)if(d.type==="childList")for(const c of d.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&a(c)}).observe(document,{childList:!0,subtree:!0});function o(s){const d={};return s.integrity&&(d.integrity=s.integrity),s.referrerPolicy&&(d.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?d.credentials="include":s.crossOrigin==="anonymous"?d.credentials="omit":d.credentials="same-origin",d}function a(s){if(s.ep)return;s.ep=!0;const d=o(s);fetch(s.href,d)}})();var ae={exports:{}},V={};/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var ye;function lt(){if(ye)return V;ye=1;var e=Ee(),n=Symbol.for("react.element"),o=Symbol.for("react.fragment"),a=Object.prototype.hasOwnProperty,s=e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,d={key:!0,ref:!0,__self:!0,__source:!0};function c(m,v,x){var f,N={},S=null,_=null;x!==void 0&&(S=""+x),v.key!==void 0&&(S=""+v.key),v.ref!==void 0&&(_=v.ref);for(f in v)a.call(v,f)&&!d.hasOwnProperty(f)&&(N[f]=v[f]);if(m&&m.defaultProps)for(f in v=m.defaultProps,v)N[f]===void 0&&(N[f]=v[f]);return{$$typeof:n,type:m,key:S,ref:_,props:N,_owner:s.current}}return V.Fragment=o,V.jsx=c,V.jsxs=c,V}var we;function dt(){return we||(we=1,ae.exports=lt()),ae.exports}var t=dt(),i=Ee(),Q={},je;function ut(){if(je)return Q;je=1;var e=nt();return Q.createRoot=e.createRoot,Q.hydrateRoot=e.hydrateRoot,Q}var pt=ut();const $={color:{surfaceAlt:"#f1f5f9",border:"#dbe2ea",textMuted:"#5b6b7d",warning:"#9a6206",warningSoft:"#fdf1dc"},shadow:{md:"0 2px 8px rgba(22, 32, 44, 0.08)"}},p={color:{bg:"#f4f7fa",surface:"#ffffff",ink:"#0d1b2a",inkSoft:"#3d4f60",primary:"#0b3d6b",primaryInk:"#ffffff",listening:"#0b6b52",listeningSoft:"#e2f4ee",speaking:"#8a4b00",speakingSoft:"#fdeedd",thinking:"#4a3b8f",thinkingSoft:"#ece9fa",error:"#9f1d17",errorSoft:"#fbe9e7",offline:"#7a4a00",offlineSoft:"#fdf0dd",progressDone:"#0b6b52",progressTodo:"#c9d4de"},touchTarget:96,type:{display:"clamp(2.75rem, 6vw, 5rem)",question:"clamp(2rem, 4.4vw, 3.5rem)",body:"clamp(1.25rem, 2.4vw, 2rem)",caption:"clamp(1rem, 1.6vw, 1.25rem)"},radius:{sm:"12px",md:"20px",pill:"999px"},duration:{fast:180,base:320}},mt={mic:"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v4M8 22h8","mic-off":"M9 9v3a3 3 0 0 0 4.6 2.5M15 11.5V5a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.4 2.4M12 18v4M8 22h8M3 3l18 18",speaker:"M11 5 6 9H2v6h4l5 4V5z","volume-off":"M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6","speaker-wave":"M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",check:"M20 6 9 17l-5-5",cross:"M18 6 6 18M6 6l12 12",repeat:"M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",help:"M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",skip:"M5 4l10 8-10 8V4zM19 5v14",stop:"M6 6h12v12H6z",globe:"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",briefcase:"M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",user:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",alert:"M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z","wifi-off":"M1 1l22 22M16.7 12.7A6 6 0 0 0 12 10M5 12.5A10 10 0 0 1 9 9.8M2 8.8a15 15 0 0 1 4.2-2.7M20 8.8a15 15 0 0 0-9.6-3.3M8.5 16.1a5 5 0 0 1 6.4-.5M12 20h.01",pause:"M6 4h4v16H6zM14 4h4v16h-4z","arrow-right":"M5 12h14M12 5l7 7-7 7","arrow-left":"M19 12H5M12 19l-7-7 7-7",clock:"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",shield:"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",lock:"M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4",star:"M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2l-5-4.9 6.9-1L12 2z",users:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",camera:"M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z","camera-off":"M1 1l22 22M9 9a4 4 0 0 0 6 6M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l1.5 2.25",search:"M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",filter:"M22 3H2l8 9.5V19l4 2v-8.5L22 3z",download:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3","chevron-down":"M6 9l6 6 6-6","chevron-right":"M9 18l6-6-6-6",x:"M18 6 6 18M6 6l12 12",menu:"M3 12h18M3 6h18M3 18h18",settings:"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.3 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 2.6 1.7 1.7 0 0 0 8 1.4V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 2.3a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z","file-text":"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",edit:"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",plus:"M12 5v14M5 12h14",trash:"M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",play:"M5 3l14 9-14 9V3z","trending-up":"M23 6l-9.5 9.5-5-5L1 18M17 6h6v6","clipboard-list":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9 12h6M9 16h6",sparkles:"M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2z"},ht=new Set(["play","skip","trash","star"]);function h({name:e,size:n=24,label:o,strokeWidth:a=2,className:s,...d}){const c=ht.has(e);return t.jsx("svg",{width:n,height:n,viewBox:"0 0 24 24",fill:c?"currentColor":"none",stroke:c?"none":"currentColor",strokeWidth:a,strokeLinecap:"round",strokeLinejoin:"round",className:s,role:o?"img":void 0,"aria-label":o,"aria-hidden":o?void 0:!0,focusable:"false",...d,children:t.jsx("path",{d:mt[e]})})}const ft=`
:root {
  --k-bg: ${p.color.bg};
  --k-surface: ${p.color.surface};
  --k-ink: ${p.color.ink};
  --k-ink-soft: ${p.color.inkSoft};
  --k-primary: ${p.color.primary};
  --k-listening: ${p.color.listening};
  --k-speaking: ${p.color.speaking};
  --k-thinking: ${p.color.thinking};
  --k-error: ${p.color.error};
  --k-touch: ${p.touchTarget}px;
}

* { box-sizing: border-box; }

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  background: var(--k-bg);
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
  font-size: ${p.type.display};
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
  max-width: 20ch;
}

.k-question {
  font-size: ${p.type.question};
  line-height: 1.22;
  font-weight: 700;
  margin: 0;
  max-width: 26ch;
}

.k-body {
  font-size: ${p.type.body};
  line-height: 1.5;
  color: var(--k-ink-soft);
  margin: 0;
  max-width: 40ch;
}

.k-caption {
  font-size: ${p.type.caption};
  color: var(--k-ink-soft);
  margin: 0;
  max-width: 44ch;
}

/* ---------- Buttons ---------- */

.k-btn {
  min-height: var(--k-touch);
  min-width: var(--k-touch);
  padding: 20px 40px;
  border-radius: ${p.radius.md};
  border: none;
  font-size: clamp(1.25rem, 2.2vw, 1.75rem);
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  transition: transform ${p.duration.fast}ms ease, box-shadow ${p.duration.fast}ms ease, background ${p.duration.fast}ms ease;
}

.k-btn:active { transform: scale(0.97); }
.k-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.k-btn-primary {
  background: var(--k-primary);
  color: ${p.color.primaryInk};
  box-shadow: 0 10px 30px rgba(11, 61, 107, 0.28);
}

.k-btn-secondary {
  background: var(--k-surface);
  color: var(--k-primary);
  border: 3px solid var(--k-primary);
}

.k-btn-ghost {
  background: transparent;
  color: var(--k-primary);
  border: 3px solid transparent;
}

.k-btn-danger {
  background: var(--k-color-error, ${p.color.error});
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
  transition: background ${p.duration.base}ms ease;
}

.k-orb-listening { background: var(--k-listening); box-shadow: 0 0 0 12px ${p.color.listeningSoft}; }
.k-orb-speaking  { background: var(--k-speaking);  box-shadow: 0 0 0 12px ${p.color.speakingSoft}; }
.k-orb-thinking { background: var(--k-thinking); box-shadow: 0 0 0 12px ${p.color.thinkingSoft}; }
.k-orb-error     { background: var(--k-error);     box-shadow: 0 0 0 12px ${p.color.errorSoft}; }
.k-orb-muted      { background: ${$.color.textMuted}; box-shadow: 0 0 0 12px ${$.color.surfaceAlt}; }

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
  border-radius: ${p.radius.pill};
  font-size: clamp(1.05rem, 1.9vw, 1.4rem);
  font-weight: 700;
  background: var(--k-surface);
  border: 3px solid transparent;
}

.k-state-listening { color: var(--k-listening); border-color: var(--k-listening); background: ${p.color.listeningSoft}; }
.k-state-speaking  { color: var(--k-speaking);  border-color: var(--k-speaking);  background: ${p.color.speakingSoft}; }
.k-state-thinking { color: var(--k-thinking); border-color: var(--k-thinking); background: ${p.color.thinkingSoft}; }
.k-state-error     { color: var(--k-error);     border-color: var(--k-error);     background: ${p.color.errorSoft}; }
.k-state-offline   { color: ${p.color.offline};  border-color: ${p.color.offline}; background: ${p.color.offlineSoft}; }

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
  border: 4px solid ${p.color.progressTodo};
  background: transparent;
  transition: background ${p.duration.base}ms ease, border-color ${p.duration.base}ms ease;
}

.k-dot--done {
  background: ${p.color.progressDone};
  border-color: ${p.color.progressDone};
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
  border-radius: ${p.radius.md};
  background: var(--k-surface);
  border: 4px solid transparent;
  box-shadow: ${$.shadow.md};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-family: inherit;
  color: var(--k-ink);
  transition: transform ${p.duration.fast}ms ease, border-color ${p.duration.fast}ms ease;
}

.k-choice:hover { border-color: var(--k-primary); transform: translateY(-2px); }
.k-choice--selected { border-color: var(--k-primary); background: #e8f0fa; }
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
  background: var(--k-surface);
  border-bottom: 2px solid ${$.color.border};
  min-height: 84px;
}

.k-topbar-title { font-size: clamp(1.1rem, 1.8vw, 1.4rem); font-weight: 800; }
.k-topbar-sub { font-size: clamp(0.85rem, 1.2vw, 1rem); color: var(--k-ink-soft); }
.k-iconbtn {
  min-width: var(--k-touch);
  min-height: var(--k-touch);
  border-radius: ${p.radius.md};
  border: 3px solid ${$.color.border};
  background: var(--k-surface);
  color: var(--k-primary);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.k-iconbtn--active { border-color: var(--k-primary); background: ${p.color.primaryInk}; }
.k-iconbtn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ---------- Misc ---------- */

.k-card {
  background: var(--k-surface);
  border-radius: ${p.radius.md};
  padding: 28px;
  box-shadow: ${$.shadow.md};
  max-width: 900px;
  width: 100%;
}

.k-transcript {
  background: var(--k-surface);
  border-left: 8px solid var(--k-primary);
  border-radius: ${p.radius.sm};
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
  border-radius: ${p.radius.pill};
  background: ${$.color.warningSoft};
  color: ${$.color.warning};
  border: 2px solid ${$.color.warning};
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
  outline: 5px solid ${p.color.primary};
  outline-offset: 4px;
  border-radius: ${p.radius.sm};
}

@media (max-height: 700px) {
  .k-center { gap: 18px; padding: 24px; }
  .k-orb { width: clamp(150px, 20vw, 200px); height: clamp(150px, 20vw, 200px); }
}
`,gt="modulepreload",kt=function(e){return"/"+e},Se={},ie=function(n,o,a){let s=Promise.resolve();if(o&&o.length>0){let c=function(x){return Promise.all(x.map(f=>Promise.resolve(f).then(N=>({status:"fulfilled",value:N}),N=>({status:"rejected",reason:N}))))};document.getElementsByTagName("link");const m=document.querySelector("meta[property=csp-nonce]"),v=m?.nonce||m?.getAttribute("nonce");s=c(o.map(x=>{if(x=kt(x),x in Se)return;Se[x]=!0;const f=x.endsWith(".css"),N=f?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${x}"]${N}`))return;const S=document.createElement("link");if(S.rel=f?"stylesheet":gt,f||(S.as="script"),S.crossOrigin="",S.href=x,v&&S.setAttribute("nonce",v),document.head.appendChild(S),f)return new Promise((_,ee)=>{S.addEventListener("load",_),S.addEventListener("error",()=>ee(new Error(`Unable to preload CSS for ${x}`)))})}))}function d(c){const m=new Event("vite:preloadError",{cancelable:!0});if(m.payload=c,window.dispatchEvent(m),!m.defaultPrevented)throw c}return s.then(c=>{for(const m of c||[])m.status==="rejected"&&d(m.reason);return n().catch(d)})},Ie="/api/v1";class j extends Error{constructor(n,o,a,s=null){super(o),this.code=n,this.status=a,this.errorId=s,this.name="KioskError"}}async function de(e,n={}){const{retries:o=0,...a}=n;for(let s=0;s<=o;s+=1)try{const d=new AbortController,c=setTimeout(()=>d.abort(),15e3);try{const m=await fetch(`${Ie}${e}`,{...a,signal:d.signal}),v=await m.text();let x=null;if(v)try{x=JSON.parse(v)}catch{x=null}if(!m.ok){const f=x?.error;throw new j(f?.code??"UNKNOWN",f?.userMessage??f?.message??"Something went wrong.",m.status,f?.errorId??null)}return x}finally{clearTimeout(c)}}catch(d){if(d instanceof j)throw d;if(s===o)break;await bt(400*2**s)}throw new j("NETWORK","The connection is temporarily lost. Please wait, we will continue.",0,null)}function bt(e){return new Promise(n=>setTimeout(n,e))}function T(e,n,o=0){return de(e,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(n),retries:o})}const E={bootstrap:()=>de("/kiosk/bootstrap",{retries:2}),startSession:e=>T("/kiosk/sessions",e,1),sessionState:e=>de(`/kiosk/sessions/${e}`,{retries:2}),consent:(e,n,o)=>T(`/kiosk/sessions/${e}/consent`,{sessionSecret:n,given:o},1),changeLanguage:(e,n,o)=>T(`/kiosk/sessions/${e}/language`,{sessionSecret:n,languageCode:o},1),turn:(e,n,o)=>T(`/kiosk/sessions/${e}/turns`,{sessionSecret:n,...o},1),advance:(e,n)=>T(`/kiosk/sessions/${e}/advance`,{sessionSecret:n},1),finish:(e,n)=>T(`/kiosk/sessions/${e}/finish`,{sessionSecret:n},2),cancel:(e,n,o)=>T(`/kiosk/sessions/${e}/cancel`,{sessionSecret:n,reason:o},0),proctor:(e,n,o)=>T(`/kiosk/sessions/${e}/proctoring`,{sessionSecret:n,...o},0),reportError:e=>T("/kiosk/report-error",e,0),audioTicket:(e,n,o)=>T(`/kiosk/sessions/${e}/audio/ticket`,{sessionSecret:n,...o},1),uploadAudioDirect:async(e,n,o,a,s)=>{const d=new URLSearchParams({sessionSecret:n,durationMs:String(a)}),c=await fetch(`${Ie}/kiosk/sessions/${e}/audio?${d.toString()}`,{method:"PUT",headers:{"content-type":s},body:o});if(!c.ok)throw new j("AUDIO_UPLOAD_FAILED","The recording could not be saved.",c.status);return await c.json()}},pe="proctor.active-session",vt="proctor-offline-queue",R="turns";function xt(e){try{localStorage.setItem(pe,JSON.stringify(e))}catch{}}function yt(){try{const e=localStorage.getItem(pe);if(!e)return null;const n=JSON.parse(e);return!n.sessionId||!n.sessionSecret||!n.jobId?null:Date.now()-n.startedAt>360*60*1e3?(me(),null):n}catch{return null}}function me(){try{localStorage.removeItem(pe)}catch{}}function G(){return new Promise((e,n)=>{const o=indexedDB.open(vt,1);o.onupgradeneeded=()=>{const a=o.result;a.objectStoreNames.contains(R)||a.createObjectStore(R,{keyPath:"clientId"}).createIndex("sessionId","sessionId")},o.onsuccess=()=>e(o.result),o.onerror=()=>n(o.error??new Error("IndexedDB open failed"))})}async function ue(e){try{const n=await G();await new Promise((o,a)=>{const s=n.transaction(R,"readwrite");s.objectStore(R).put({...e,clientId:`${e.createdAt}-${Math.random().toString(36).slice(2,9)}`}),s.oncomplete=()=>o(),s.onerror=()=>a(s.error)}),n.close()}catch{}}async function Le(e){try{const n=await G(),o=await new Promise((a,s)=>{const c=n.transaction(R,"readonly").objectStore(R).index("sessionId").getAll(e);c.onsuccess=()=>a(c.result),c.onerror=()=>s(c.error)});return n.close(),o.sort((a,s)=>a.createdAt-s.createdAt)}catch{return[]}}async function Ce(e){try{const n=await G();await new Promise((o,a)=>{const s=n.transaction(R,"readwrite");s.objectStore(R).delete(e),s.oncomplete=()=>o(),s.onerror=()=>a(s.error)}),n.close()}catch{}}async function Te(){try{const e=await G();await new Promise((n,o)=>{const a=e.transaction(R,"readwrite");a.objectStore(R).clear(),a.oncomplete=()=>n(),a.onerror=()=>o(a.error)}),e.close()}catch{}}async function W(){me(),await Te();try{sessionStorage.clear()}catch{}}const Me=Object.freeze(Object.defineProperty({__proto__:null,clearPersistedSession:me,clearQueue:Te,enqueueTurn:ue,persistSession:xt,readPersistedSession:yt,readQueuedTurns:Le,removeQueuedTurn:Ce,resetLocalData:W},Symbol.toStringTag,{value:"Module"}));function wt(e={}){const[n,o]=i.useState(null),[a,s]=i.useState("boot"),[d,c]=i.useState(()=>typeof navigator>"u"?!0:navigator.onLine),[m,v]=i.useState(null),[x,f]=i.useState(null),[N,S]=i.useState({answered:0,total:0,label:null}),[_,ee]=i.useState(0),[te,$e]=i.useState(!1),[Ae,D]=i.useState(null),[Oe,B]=i.useState("en"),[_e,z]=i.useState(null),[De,he]=i.useState(!1),I=i.useRef(null),L=i.useRef(null),P=i.useRef(null),fe=i.useRef(null),He=i.useRef(new rt),w=i.useRef(null),ge=i.useRef("boot"),C=i.useRef("en"),ne=i.useRef(null),K=i.useRef(!1),re=i.useRef(!1),qe=i.useRef(null),Y=i.useRef(0),ke=i.useRef(!1),g=i.useCallback(r=>{ge.current=r,s(r),e.onPhaseChange?.(r)},[e]);i.useEffect(()=>{ke.current||(ke.current=!0,Fe())},[]);const Fe=i.useCallback(async()=>{try{const r=await E.bootstrap();o(r),ne.current=r.voice;const l=r.languages.map(b=>b.code),u=l.includes(r.defaultLanguage)?r.defaultLanguage:l[0]??"en";C.current=u,B(u),I.current=new ot({language:C.current,rate:r.voice.rate,pitch:r.voice.pitch,volume:r.voice.volume,onStateChange:b=>{b==="SPEAKING"&&(K.current=!0),b==="IDLE"&&(K.current=!1,ge.current==="speaking"&&g(L.current?"listening":"idle"))},onLevel:b=>{P.current?.setEchoReference(b>-80?b:null)}}),await I.current.selectVoice(C.current,r.languages[0]?.ttsVoiceHint??null);const{readPersistedSession:k}=await ie(async()=>{const{readPersistedSession:b}=await Promise.resolve().then(()=>Me);return{readPersistedSession:b}},void 0),y=k();if(y&&r.resume?.sessionId===y.sessionId){w.current=y,D(y),C.current=y.languageCode,B(y.languageCode),I.current.setLanguage(y.languageCode),g("idle"),await oe(),await O("",1,0,{silent:!0,replay:!0});return}g("idle")}catch(r){const l=r instanceof j?r.message:"There is a small technical problem. Please call the person at the desk.";z({code:"BOOT_FAILED",message:l,errorId:r instanceof j?r.errorId:null}),g("error")}},[g]);i.useEffect(()=>{const r=()=>{c(!0),We()},l=()=>c(!1);return window.addEventListener("online",r),window.addEventListener("offline",l),()=>{window.removeEventListener("online",r),window.removeEventListener("offline",l)}},[]);const oe=i.useCallback(async()=>{if(!P.current)try{const r=await st({vad:{silenceHangoverMs:1400,onsetFrames:2},onLevel:(l,u,k)=>{}});if(P.current=r,n?.kiosk.autoStartAudio!==!1){const l=new at({stream:r.stream,enabled:!1,onSegment:u=>{}});fe.current=l}se(),Ve()}catch{z({code:"MIC_UNAVAILABLE",message:"I cannot use the microphone. Please call the person at the desk for help.",errorId:null}),g("error")}},[n?.kiosk.autoStartAudio]),se=i.useCallback(()=>{if(!ve())return;const r=C.current,l=xe(r),u=new it({language:l,continuous:!0,interimResults:!0,vocabularyHints:St(w.current),onResult:k=>Ue(k),onError:()=>{}});L.current=u,u.start()},[]),Ve=i.useCallback(()=>{const r=()=>{const l=P.current;if(l){l.poll();const u=l.peakLevelDb(),k=Math.max(0,Math.min(1,(u+60)/54));ee(k)}Y.current=requestAnimationFrame(r)};cancelAnimationFrame(Y.current),Y.current=requestAnimationFrame(r)},[]);i.useEffect(()=>()=>cancelAnimationFrame(Y.current),[]);const J=i.useCallback(async r=>{const l=I.current;if(!(!l||r.length===0)){for(const u of r){const k=u.text?.trim();k&&(u.displayText&&v(u.displayText),await l.speak({text:k,rate:u.slowRate?ne.current?.slowRate??.68:ne.current?.rate??.92}))}v(null)}},[]),A=i.useCallback(r=>{S(r.progress),J(r.directives??[])},[J]),O=i.useCallback(async(r,l=.8,u=0,k={})=>{const y=w.current;if(!(!y||re.current)){re.current=!0;try{const b=r.trim()?{transcript:r.trim(),spokenLanguage:C.current,confidence:l,durationMs:u}:{transcript:"",spokenLanguage:null,confidence:1,durationMs:0};if(!navigator.onLine&&r.trim()){await ue({sessionId:y.sessionId,transcript:b.transcript,spokenLanguage:b.spokenLanguage,confidence:b.confidence,durationMs:b.durationMs,createdAt:Date.now()}),g("offline");return}k.silent||g("thinking");const F=await E.turn(y.sessionId,y.sessionSecret,b);f(null),A(F),F.terminal==="COMPLETED"?await q():F.terminal?(g("idle"),await W()):k.silent||g(L.current?"listening":"idle")}catch(b){await be(b,r,l,u)}finally{re.current=!1}}},[A,g]),be=i.useCallback(async(r,l,u,k)=>{const y=w.current;if(r instanceof j&&r.code==="NETWORK"){y&&l.trim()&&await ue({sessionId:y.sessionId,transcript:l,spokenLanguage:C.current,confidence:u,durationMs:k,createdAt:Date.now()}),g("offline"),E.reportError({code:"TURN_NETWORK",sessionId:y?.sessionId}).catch(()=>{});return}if(r instanceof j&&(r.code==="SESSION_LOCKED"||r.code==="NOT_FOUND"||r.code==="SESSION_EXPIRED")){await W(),w.current=null,D(null),z({code:r.code,message:"This interview has ended. Please start again from the beginning.",errorId:null}),g("error");return}const b=r instanceof j?r.message:"There is a small technical problem. Please wait a moment.";z({code:r instanceof j?r.code:"TURN_FAILED",message:b,errorId:r instanceof j?r.errorId:null}),g("error"),E.reportError({code:"TURN_FAILED",...y?{sessionId:y.sessionId}:{},...r instanceof j&&r.errorId?{errorId:r.errorId}:{}}).catch(()=>{})},[g]),We=i.useCallback(async()=>{const r=w.current;if(!r)return;const l=await Le(r.sessionId);if(l.length!==0)for(const u of l)try{const k=await E.turn(r.sessionId,r.sessionSecret,{transcript:u.transcript,spokenLanguage:u.spokenLanguage,confidence:u.confidence,durationMs:u.durationMs});if(await Ce(u.clientId),k.terminal==="COMPLETED"){await q();return}}catch{break}},[]),Ue=i.useCallback(r=>{if(te)return;if(!r.isFinal){f(r.transcript);return}if(f(r.transcript),K.current&&(I.current?.cancel(),K.current=!1),!w.current)return;const l=r.command??ct(r.transcript,C.current).command;if(l){O(jt(l),Math.max(.8,r.confidence),r.receivedAtMs?400:0);return}O(r.transcript,r.confidence||.75,2e3)},[te,O]),Be=i.useCallback(async({jobId:r,languageCode:l})=>{z(null);try{const u=await E.startSession({jobId:r,kioskId:n?.kiosk.kioskId??"default",...l?{languageCode:l}:{},...n?.demoMode?{demoMode:!0}:{}});C.current=u.languageCode,B(u.languageCode);const k={sessionId:u.sessionId,publicId:u.publicId,sessionSecret:u.sessionSecret,jobId:r,jobTitle:u.jobTitle,languageCode:u.languageCode,startedAt:Date.now()},{persistSession:y}=await ie(async()=>{const{persistSession:b}=await Promise.resolve().then(()=>Me);return{persistSession:b}},void 0);if(y(k),w.current=k,D(k),I.current?.setLanguage(u.languageCode),u.proctoring.kioskFullscreenEnforced){const{enterFullscreen:b}=await ie(async()=>{const{enterFullscreen:F}=await Promise.resolve().then(()=>Ht);return{enterFullscreen:F}},void 0);b()}await oe(),g("listening")}catch(u){const k=u instanceof j?u.message:"We could not start the interview. Please call the person at the desk.";z({code:"START_FAILED",message:k,errorId:u instanceof j?u.errorId:null}),g("error")}},[n,g,oe]),Ke=i.useCallback(async r=>{const l=w.current;if(l)try{const u=await E.consent(l.sessionId,l.sessionSecret,r);A(u),r?g("listening"):(await W(),g("idle"))}catch(u){const k=u instanceof j?u.message:"There is a small technical problem. Please wait a moment.";z({code:"CONSENT_FAILED",message:k,errorId:u instanceof j?u.errorId:null}),g("error")}},[A,g]),Ye=i.useCallback(async r=>{const l=w.current;if(C.current=r,B(r),I.current?.setLanguage(r),L.current?.setLanguage(xe(r)),!!l){try{const u=await E.changeLanguage(l.sessionId,l.sessionSecret,r);A(u)}catch{await J([{text:"",emotion:"neutral",displayText:null,slowRate:!1,sequence:0}])}D({...l,languageCode:r})}},[A,J]),Je=i.useCallback(async()=>{const r=w.current;if(r)try{const l=await E.advance(r.sessionId,r.sessionSecret);A(l),l.terminal==="COMPLETED"&&await q()}catch(l){await be(l,"",0,0)}},[A]),Qe=i.useCallback(async()=>{const r=w.current;if(r){try{await E.finish(r.sessionId,r.sessionSecret)}catch{}await q()}},[]),Ge=i.useCallback(async r=>{const l=w.current;if(l){try{await E.cancel(l.sessionId,l.sessionSecret,r)}catch{}await q()}},[]),q=i.useCallback(async()=>{L.current?.stop(),L.current=null,P.current?.stop(),P.current=null,fe.current?.stopAndDiscard(),I.current?.cancel(),await W(),w.current=null,D(null),v(null),f(null),g("complete")},[g]),Xe=i.useCallback(()=>{$e(r=>{const l=!r;return l?(L.current?.stop(),I.current?.cancel()):se(),l})},[se]),Ze=i.useCallback(()=>{O("Repeat",.95,500)},[O]),et=i.useCallback(()=>{L.current?.stop(),L.current=null,P.current?.stop(),P.current=null,w.current=null,D(null),z(null),v(null),f(null),S({answered:0,total:0,label:null}),g("idle")},[g]),tt=i.useCallback((r,l)=>{E.reportError({code:r,...w.current?{sessionId:w.current.sessionId}:{}}).catch(()=>{}),l&&z({code:r,message:l,errorId:null})},[]);return i.useEffect(()=>{const r=setInterval(()=>{},1073741824);return()=>clearInterval(r)},[]),i.useEffect(()=>{qe.current=m},[m]),i.useEffect(()=>()=>{L.current?.stop(),P.current?.stop(),I.current?.cancel(),He.current.clear()},[]),{bootstrap:n,phase:a,online:d,caption:m,heardText:x,progress:N,micLevel:_,muted:te,demo:n?.demoMode??!1,speechAvailable:typeof window<"u"&&ve(),session:Ae,languageCode:Oe,error:_e,helpOpen:De,startSession:Be,submitConsent:Ke,submitTurn:O,skipCurrent:Je,finish:Qe,cancel:Ge,setLanguage:Ye,toggleMute:Xe,repeatLast:Ze,openHelp:()=>he(!0),closeHelp:()=>he(!1),resetToWelcome:et,reportError:tt}}function jt(e){switch(e){case"REPEAT":return"Repeat";case"SPEAK_SLOWLY":return"Speak slowly";case"DONT_UNDERSTAND":return"I don't understand";case"NEXT":return"Next";case"GO_BACK":return"Go back";case"DONT_KNOW":return"I don't know";case"STOP":return"Stop";case"START_AGAIN":return"Start again";case"HELP":return"Help";default:return"Next"}}function St(e){if(!e)return[];const n=e.jobTitle.split(/\s+/).filter(o=>o.length>3);return[...new Set([...n,"helmet","gloves","supervisor","machine","shift"])]}function M({children:e,onClick:n,variant:o="primary",disabled:a,icon:s,ariaLabel:d,type:c="button",style:m}){return t.jsxs("button",{type:c,className:`k-btn k-btn-${o}`,onClick:n,disabled:a,"aria-label":d,style:m,children:[s,e]})}function U({message:e}){return t.jsx("div",{className:"k-sr-only",role:"status","aria-live":"polite","aria-atomic":"true",children:e})}function Mt({answered:e,total:n,label:o}){if(n<=0)return null;const a=Math.min(n,12),s=n<=a?e:Math.round(e/n*a);return t.jsxs("div",{className:"k-progress",role:"progressbar","aria-valuemin":0,"aria-valuemax":n,"aria-valuenow":e,children:[Array.from({length:a},(d,c)=>t.jsx("span",{className:`k-dot${c<s?" k-dot--done":""}${c===s?" k-dot--current":""}`,"aria-hidden":"true"},c)),o&&t.jsx("span",{className:"k-progress-label",children:o})]})}function Nt({kiosk:e,onContinue:n}){const{bootstrap:o}=e,[a,s]=i.useState(!1);if(i.useEffect(()=>{a||s(!0)},[a]),!o)return null;const d=!e.speechAvailable;return t.jsxs("div",{className:"k-screen",children:[t.jsx(X,{kiosk:e,title:o.siteName,subtitle:o.jobs.length>0?void 0:"No jobs are open right now"}),t.jsxs("main",{className:"k-center",children:[t.jsx(h,{name:"mic",size:72,color:"var(--k-primary)","aria-hidden":!0}),t.jsx("h1",{className:"k-display",children:"Welcome"}),t.jsxs("p",{className:"k-body",children:["I will ask you a few simple questions for the job application.",t.jsx("br",{}),"You only need to ",t.jsx("strong",{children:"speak"})," your answers.",t.jsx("br",{}),"There is no need to type or read anything."]}),d&&t.jsxs("div",{className:"k-state k-state-error",style:{maxWidth:560},children:[t.jsx(h,{name:"alert",size:32,"aria-hidden":!0}),t.jsx("span",{children:"This kiosk needs a keyboard with a microphone and speakers. Please call the person at the desk."})]}),t.jsxs("div",{className:"k-btn-row",children:[t.jsx(M,{onClick:n,icon:t.jsx(h,{name:"play",size:38,"aria-hidden":!0}),children:"Start"}),t.jsx(M,{variant:"secondary",onClick:()=>e.openHelp(),icon:t.jsx(h,{name:"help",size:36,"aria-hidden":!0}),children:"Help"})]}),t.jsx(U,{message:"Welcome. I will ask you a few simple questions. You only need to speak your answers."})]}),t.jsx(Et,{})]})}function X({kiosk:e,title:n,subtitle:o,showHelp:a=!0}){return t.jsxs("header",{className:"k-topbar",children:[t.jsxs("div",{children:[t.jsx("div",{className:"k-topbar-title",children:n}),o&&t.jsx("div",{className:"k-topbar-sub",children:o})]}),t.jsxs("div",{style:{display:"flex",gap:12,alignItems:"center"},children:[!e.online&&t.jsxs("div",{className:"k-state k-state-offline",role:"status",children:[t.jsx(h,{name:"wifi-off",size:30,"aria-hidden":!0}),t.jsx("span",{children:"No connection"})]}),e.session&&t.jsx("button",{type:"button",className:`k-iconbtn${e.muted?" k-iconbtn--active":""}`,onClick:e.toggleMute,"aria-pressed":e.muted,"aria-label":e.muted?"Turn the microphone on":"Turn the microphone off",title:e.muted?"Microphone off — tap to turn on":"Microphone on — tap to mute",children:t.jsx(h,{name:e.muted?"mic-off":"mic",size:40,"aria-hidden":!0})}),e.session&&t.jsx("button",{type:"button",className:"k-iconbtn",onClick:e.repeatLast,"aria-label":"Say the question again",title:"Say the question again",children:t.jsx(h,{name:"repeat",size:40,"aria-hidden":!0})}),a&&t.jsx("button",{type:"button",className:"k-iconbtn",onClick:e.openHelp,"aria-label":"Get help",title:"Get help",children:t.jsx(h,{name:"help",size:40,"aria-hidden":!0})})]})]})}function Et(){return t.jsxs("footer",{style:{padding:"18px 24px",textAlign:"center",fontSize:"clamp(0.9rem, 1.4vw, 1.05rem)",color:"var(--k-ink-soft)"},children:["If you need help, please say ",t.jsx("strong",{children:"“help”"})," or touch the help button."]})}function It({languages:e,current:n,onSelect:o,onBack:a}){return t.jsx("div",{className:"k-screen",children:t.jsxs("main",{className:"k-center",children:[t.jsx(h,{name:"globe",size:68,color:"var(--k-primary)","aria-hidden":!0}),t.jsx("h1",{className:"k-question",children:"Which language would you like to use?"}),t.jsx("p",{className:"k-caption",children:"Please speak the language name, or touch it on the screen."}),t.jsx("div",{className:"k-choices",children:e.map(s=>t.jsxs("button",{type:"button",className:`k-choice${s.code===n?" k-choice--selected":""}`,onClick:()=>o(s.code),"aria-pressed":s.code===n,children:[t.jsx("span",{className:"k-choice-native",lang:s.code,children:s.nativeName}),s.nativeName!==s.name&&t.jsx("span",{className:"k-choice-name",children:s.name}),s.code===n&&t.jsx(h,{name:"check",size:34,color:"var(--k-primary)","aria-label":"Selected"})]},s.code))}),t.jsx("div",{className:"k-btn-row",children:a&&t.jsx(M,{variant:"secondary",onClick:a,icon:t.jsx(h,{name:"arrow-left",size:34,"aria-hidden":!0}),children:"Back"})})]})})}function Lt({jobs:e,onSelect:n,onBack:o}){return t.jsx("div",{className:"k-screen",children:t.jsxs("main",{className:"k-center",children:[t.jsx(h,{name:"briefcase",size:68,color:"var(--k-primary)","aria-hidden":!0}),t.jsx("h1",{className:"k-question",children:"Which job do you want to apply for?"}),t.jsx("p",{className:"k-caption",children:"Please say the job name, or touch it on the screen."}),t.jsx("div",{className:"k-choices",children:e.map(a=>t.jsxs("button",{type:"button",className:"k-choice",onClick:()=>n(a.id),children:[t.jsx(h,{name:"briefcase",size:44,color:"var(--k-primary)","aria-hidden":!0}),t.jsx("span",{className:"k-choice-title",children:a.title}),t.jsxs("span",{className:"k-choice-meta",children:[a.questionCount," questions · about ",a.durationMinutes," minutes"]}),a.location&&t.jsx("span",{className:"k-choice-meta",children:a.location})]},a.id))}),t.jsx("div",{className:"k-btn-row",children:t.jsx(M,{variant:"secondary",onClick:o,icon:t.jsx(h,{name:"arrow-left",size:34,"aria-hidden":!0}),children:"Back"})})]})})}function Ct({state:e,level:n,onToggle:o,disabled:a}){const d={listening:{icon:"mic",label:"Listening",text:"I am listening"},speaking:{icon:"speaker-wave",label:"Speaking",text:"Please listen"},thinking:{icon:"help",label:"Thinking",text:"One moment"},error:{icon:"alert",label:"Problem",text:"There is a problem"},offline:{icon:"wifi-off",label:"No connection",text:"Please wait"},muted:{icon:"mic-off",label:"Microphone off",text:"Microphone off"}}[e];return t.jsxs("button",{type:"button",className:`k-orb k-orb-${e}`,onClick:o,disabled:a,"aria-label":o?`${d.label}. Tap to ${e==="listening"?"pause":"resume"}`:d.label,style:{transform:`scale(${1+n*.05})`},children:[t.jsx("span",{className:"k-orb-ring","aria-hidden":"true"}),t.jsx("span",{className:"k-orb-level",style:{"--level":1+n*.4},"aria-hidden":"true"}),t.jsx(h,{name:d.icon,size:96,strokeWidth:1.75,"aria-hidden":!0})]})}function Tt({state:e}){const o={listening:{icon:"mic",text:"I am listening — please speak"},speaking:{icon:"speaker-wave",text:"Please listen"},thinking:{icon:"help",text:"One moment please"},error:{icon:"alert",text:"There is a problem"},offline:{icon:"wifi-off",text:"Connection lost — your answers are saved"},muted:{icon:"mic-off",text:"Microphone is off"}}[e];return t.jsxs("div",{className:`k-state k-state-${e}`,children:[t.jsx(h,{name:o.icon,size:34,"aria-hidden":!0}),t.jsx("span",{children:o.text})]})}function Rt({kiosk:e}){const[n,o]=i.useState(!1),a=e.phase==="speaking",s=e.phase==="listening";return t.jsxs("div",{className:"k-screen",children:[t.jsx(X,{kiosk:e,title:e.session?.jobTitle??"Interview",subtitle:(e.session,void 0)}),t.jsxs("main",{className:"k-center",style:{gap:26,paddingTop:20,paddingBottom:12},children:[t.jsx(Tt,{state:a?"speaking":s?"listening":e.phase==="offline"?"offline":e.phase==="error"?"error":"thinking"}),t.jsx(Ct,{state:e.muted?"muted":a?"speaking":s?"listening":e.phase==="offline"?"offline":"thinking",level:e.micLevel,onToggle:e.toggleMute}),e.caption&&t.jsx("p",{className:"k-question",children:e.caption},e.caption),e.heardText&&t.jsxs("p",{className:"k-transcript","aria-live":"polite",children:[t.jsx("span",{style:{opacity:.7,fontSize:"0.85em"},children:"You said: "}),e.heardText]}),t.jsx(Mt,{answered:e.progress.answered,total:e.progress.total,label:e.progress.label})]}),t.jsxs("footer",{style:{padding:"14px 20px 22px",display:"flex",justifyContent:"center",gap:14,flexWrap:"wrap"},children:[t.jsx(M,{variant:"secondary",onClick:e.repeatLast,icon:t.jsx(h,{name:"repeat",size:34,"aria-hidden":!0}),ariaLabel:"Say the question again",children:"Again"}),t.jsx(M,{variant:"secondary",onClick:()=>void e.submitTurn("Speak slowly"),icon:t.jsx(h,{name:"user",size:34,"aria-hidden":!0}),ariaLabel:"Speak more slowly",children:"Slower"}),t.jsx(M,{variant:"secondary",onClick:()=>void e.submitTurn("I don't understand"),icon:t.jsx(h,{name:"help",size:34,"aria-hidden":!0}),ariaLabel:"I do not understand",children:"I don't know"}),t.jsx(M,{variant:"secondary",onClick:()=>void e.skipCurrent(),icon:t.jsx(h,{name:"skip",size:34,"aria-hidden":!0}),ariaLabel:"Go to the next question",children:"Next"}),t.jsx(M,{variant:n?"danger":"ghost",onClick:()=>{if(n){e.cancel("Candidate asked to stop");return}o(!0),setTimeout(()=>o(!1),6e3)},icon:t.jsx(h,{name:n?"cross":"stop",size:32,"aria-hidden":!0}),ariaLabel:n?"Confirm: end the interview now":"End the interview",children:n?"End now?":"End"})]}),t.jsx(U,{message:e.caption??""})]})}function zt({kiosk:e,onDone:n}){const o=e.bootstrap?.scoring.discloseScoreToCandidate??!1,a=e.bootstrap?.resetDelaySeconds??20;return t.jsx("div",{className:"k-screen",children:t.jsxs("main",{className:"k-center",children:[t.jsx("div",{className:"k-orb k-orb-listening",style:{width:190,height:190,cursor:"default"},children:t.jsx(h,{name:"check",size:96,strokeWidth:2.5,"aria-hidden":!0})}),t.jsx("h1",{className:"k-display",children:"Thank you"}),t.jsxs("p",{className:"k-body",children:["You have completed the interview.",t.jsx("br",{}),"Your application has been submitted successfully."]}),o&&t.jsx("p",{className:"k-body",children:"Your result will be shared with the recruitment team."}),t.jsxs("p",{className:"k-caption",children:["This screen will reset in ",a," seconds."]}),t.jsx(M,{onClick:n,icon:t.jsx(h,{name:"arrow-right",size:34,"aria-hidden":!0}),children:"Finish"}),t.jsx("p",{className:"k-caption",children:"Please give the slip to the person at the desk."}),t.jsx(U,{message:"Thank you. You have completed the interview. Your application has been submitted successfully."})]})})}function Pt({kiosk:e}){const n=e.error;return t.jsx("div",{className:"k-screen",children:t.jsxs("main",{className:"k-center",children:[t.jsx("div",{className:"k-orb k-orb-error",style:{width:170,height:170,cursor:"default"},children:t.jsx(h,{name:"alert",size:80,"aria-hidden":!0})}),t.jsx("h1",{className:"k-question",children:"Please wait"}),t.jsx("p",{className:"k-body",children:n?.message??"There is a small technical problem. Please wait a moment."}),t.jsx("p",{className:"k-caption",children:"Please call the person at the desk for help."}),t.jsx("div",{className:"k-btn-row",children:t.jsx(M,{onClick:()=>{e.reportError("RETRY_FROM_ERROR"),e.resetToWelcome()},icon:t.jsx(h,{name:"repeat",size:34,"aria-hidden":!0}),children:"Start again"})}),n?.errorId&&t.jsxs("p",{className:"k-caption",style:{opacity:.6},children:["Reference for the support team: ",n.errorId]}),t.jsx(U,{message:n?.message??"There is a small technical problem. Please call the person at the desk for help."})]})})}function $t({kiosk:e}){const n=[{icon:"repeat",say:"“Again”",does:"Ask the same question once more"},{icon:"user",say:"“Slower”",does:"Speak more slowly and simply"},{icon:"help",say:"“I don’t understand”",does:"Ask the question in a simpler way"},{icon:"skip",say:"“Next”",does:"Move to the next question"},{icon:"arrow-left",say:"“Back”",does:"Go back one question"},{icon:"help",say:"“I don’t know”",does:"Skip without any problem"},{icon:"stop",say:"“Stop”",does:"End the interview now"},{icon:"globe",say:"“Marathi” / “Hindi”",does:"Change the language"}];return t.jsx("div",{role:"dialog","aria-modal":"true","aria-label":"Help",style:{position:"fixed",inset:0,background:"rgba(13, 27, 42, 0.55)",display:"grid",placeItems:"center",padding:24,zIndex:50},onClick:()=>e.closeHelp(),children:t.jsxs("div",{className:"k-card",style:{maxWidth:760,maxHeight:"86vh",overflow:"auto"},onClick:o=>o.stopPropagation(),children:[t.jsx("h2",{className:"k-question",style:{marginBottom:18},children:"What you can say"}),t.jsx("ul",{style:{listStyle:"none",padding:0,margin:0,display:"grid",gap:12},children:n.map(o=>t.jsxs("li",{style:{display:"flex",alignItems:"center",gap:16,padding:"12px 14px",background:"var(--k-bg)",borderRadius:12},children:[t.jsx(h,{name:o.icon,size:32,color:"var(--k-primary)","aria-hidden":!0}),t.jsx("span",{style:{fontSize:"clamp(1.05rem,1.7vw,1.3rem)",fontWeight:700,minWidth:200},children:o.say}),t.jsx("span",{className:"k-caption",style:{margin:0},children:o.does})]},o.say))}),t.jsxs("div",{className:"k-state k-state-error",style:{marginTop:20,maxWidth:"none"},children:[t.jsx(h,{name:"alert",size:30,"aria-hidden":!0}),t.jsx("span",{children:"If something goes wrong, please say “help” or call the person at the desk. Your answers are saved."})]}),t.jsx("div",{style:{display:"flex",justifyContent:"center",marginTop:22},children:t.jsx(M,{onClick:e.closeHelp,icon:t.jsx(h,{name:"cross",size:32,"aria-hidden":!0}),children:"Close"})})]})})}function At({kiosk:e,onAgree:n,onDecline:o}){const[a,s]=i.useState(!1),d=e.bootstrap?.consentPhraseKey;return i.useEffect(()=>{if(!a)return;const c=setTimeout(()=>s(!1),6e3);return()=>clearTimeout(c)},[a]),e.bootstrap?t.jsxs("div",{className:"k-screen",children:[t.jsx(X,{kiosk:e,title:e.session?.jobTitle??"Job application",showHelp:!1}),t.jsxs("main",{className:"k-center",children:[t.jsx(h,{name:"shield",size:68,color:"var(--k-primary)","aria-hidden":!0}),t.jsx("h1",{className:"k-question",children:"Before we begin"}),t.jsxs("div",{className:"k-card",style:{textAlign:"left",maxWidth:780},children:[t.jsx("p",{className:"k-body",style:{marginBottom:16},children:"This interview uses your voice to understand your answers."}),t.jsx("p",{className:"k-caption",style:{textAlign:"left"},children:"Your interview information may be stored for recruitment purposes."}),t.jsx("p",{className:"k-caption",style:{textAlign:"left",marginTop:12},children:"You will be asked one question at a time. You can say “again”, “slower”, or “I don't know” at any time. You can stop whenever you want."}),t.jsx("p",{className:"k-caption",style:{textAlign:"left",marginTop:12,opacity:.8},children:e.bootstrap.jurisdictionNote})]}),t.jsx("p",{className:"k-question",style:{fontSize:"clamp(1.6rem, 3vw, 2.4rem)"},children:"Do you agree to continue?"}),t.jsx("p",{className:"k-caption",children:"Please say “yes” or “no”."}),t.jsxs("div",{className:"k-btn-row",children:[t.jsx(M,{onClick:n,icon:t.jsx(h,{name:"check",size:38,"aria-hidden":!0}),ariaLabel:"Yes, I agree",children:"Yes, I agree"}),t.jsx(M,{variant:a?"danger":"secondary",onClick:()=>a?o():s(!0),icon:t.jsx(h,{name:a?"cross":"stop",size:34,"aria-hidden":!0}),ariaLabel:a?"Confirm: I do not agree":"No, I do not agree",children:a?"Confirm no":"No, I do not agree"})]}),t.jsx(U,{message:d?"This interview uses your voice to understand your answers. Your interview information may be stored for recruitment purposes. Do you agree to continue? Please say yes or no.":"Do you agree to continue? Please say yes or no."})]})]}):null}let H=null;async function Re(){if(typeof navigator>"u"||!("wakeLock"in navigator))return()=>{};try{H=await navigator.wakeLock.request("screen")}catch{H=null}return()=>{H?.release().catch(()=>{}),H=null}}function Z(){return typeof document>"u"?!1:!!document.fullscreenElement}async function Ot(){if(typeof document>"u")return!1;if(Z())return!0;try{return await document.documentElement.requestFullscreen(),!0}catch{return!1}}async function ze(){if(Z())try{await document.exitFullscreen()}catch{}}function Pe(e){const n=c=>{if(e.preventRefresh)return e.onBeforeUnload?.(),c.preventDefault(),c.returnValue="",""};window.addEventListener("beforeunload",n);const o=()=>{Z()||e.onFullscreenExit?.()};document.addEventListener("fullscreenchange",o);const a=()=>e.onVisibilityChange?.(document.visibilityState==="visible");document.addEventListener("visibilitychange",a);const s=c=>c.preventDefault();document.addEventListener("contextmenu",s);const d=c=>{if(!e.preventRefresh)return;(c.key==="F5"&&!c.ctrlKey||c.ctrlKey&&c.key.toLowerCase()==="r"||c.ctrlKey&&c.key.toLowerCase()==="w"||c.ctrlKey&&c.shiftKey&&c.key.toLowerCase()==="i")&&(c.preventDefault(),e.onFullscreenExit?.())};return window.addEventListener("keydown",d,!0),{release(){ze(),H?.release().catch(()=>{}),H=null},dispose(){window.removeEventListener("beforeunload",n),document.removeEventListener("fullscreenchange",o),document.removeEventListener("visibilitychange",a),document.removeEventListener("contextmenu",s),window.removeEventListener("keydown",d,!0)}}}function _t(e){return e?"":"The connection is temporarily lost. Please wait. Your answers are saved on this machine."}const Dt=p.color,Ht=Object.freeze(Object.defineProperty({__proto__:null,KIOSK_COLORS:Dt,describeConnectivity:_t,enterFullscreen:Ot,exitFullscreen:ze,installKioskGuards:Pe,isFullscreen:Z,keepScreenAwake:Re},Symbol.toStringTag,{value:"Module"})),Ne=["welcome","language","job","consent","interview","complete"];function qt(){const e=wt(),[n,o]=i.useState(()=>"welcome"),a=i.useCallback(d=>{o(c=>{if(c==="error"||c==="complete")return d;const m=Ne.indexOf(c);return Ne.indexOf(d)>m+1?c:d})},[]);i.useEffect(()=>{if(e.phase==="complete"){o("complete");return}if(e.phase==="error"){o("error");return}e.session&&n==="welcome"&&o("interview")},[e.phase,e.session,n]),i.useEffect(()=>{let d;Re().then(m=>{d=m});const c=Pe({preventRefresh:e.session!==null,onFullscreenExit:()=>ce(e,"FULLSCREEN_EXITED",.9),onVisibilityChange:m=>{m||ce(e,"WINDOW_BLURRED",.6)},onBeforeUnload:()=>{ce(e,"UNUSUAL_INTERRUPTION",.5)}});return()=>{c.dispose(),d?.()}},[e]),i.useEffect(()=>{const d=e.bootstrap?.kiosk.accessibility.reducedMotion??!1;document.documentElement.classList.toggle("k-reduced-motion",d)},[e.bootstrap?.kiosk.accessibility.reducedMotion]);const s=e.session&&n==="welcome"?"interview":n;return t.jsxs(t.Fragment,{children:[t.jsx("style",{children:ft}),e.demo&&t.jsx("div",{className:"k-demo",children:"DEMO MODE — SAMPLE DATA"}),e.helpOpen&&t.jsx($t,{kiosk:e}),s==="welcome"&&t.jsx(Nt,{kiosk:e,onContinue:()=>a("language")}),s==="language"&&t.jsx(It,{languages:e.bootstrap?.languages??[],current:e.languageCode,onSelect:d=>{e.setLanguage(d),a("job")},onBack:()=>a("welcome")}),s==="job"&&t.jsx(Lt,{jobs:e.bootstrap?.jobs??[],onSelect:d=>{(async()=>(await e.startSession({jobId:d,languageCode:e.languageCode}),a("consent")))()},onBack:()=>a("language")}),s==="consent"&&t.jsx(At,{kiosk:e,onAgree:()=>{e.submitConsent(!0),a("interview")},onDecline:()=>{e.submitConsent(!1),o("complete")}}),s==="interview"&&t.jsx(Rt,{kiosk:e}),s==="complete"&&t.jsx(zt,{kiosk:e,onDone:()=>{e.resetToWelcome(),o("welcome")}}),s==="error"&&t.jsxs("div",{className:"k-screen",children:[t.jsx(X,{kiosk:e,title:e.bootstrap?.siteName??"Kiosk",showHelp:!1}),t.jsx(Pt,{kiosk:e})]})]})}function ce(e,n,o){const a=e.session;if(!a)return;const s=`/api/v1/kiosk/sessions/${a.sessionId}/proctoring`;fetch(s,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionSecret:a.sessionSecret,type:n,confidence:o})}).catch(()=>{})}const le=document.getElementById("root");if(!le)document.body.textContent="This kiosk could not start. Please call the person at the desk.";else try{pt.createRoot(le).render(t.jsx(i.StrictMode,{children:t.jsx(qt,{})}))}catch(e){const n="This kiosk could not start. Please call the person at the desk.";le.textContent=n,fetch("/api/v1/kiosk/report-error",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:"REACT_MOUNT_FAILED",context:{message:e?.message??"unknown"}})}).catch(()=>{})}"scrollRestoration"in history&&(history.scrollRestoration="manual");window.addEventListener("pageshow",e=>{e.persisted&&window.location.reload()});
//# sourceMappingURL=index-MBe_biz7.js.map
