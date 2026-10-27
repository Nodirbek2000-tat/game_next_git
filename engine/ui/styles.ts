// Self-contained stylesheet of the play screen (prefixed .hk-). Independent of the site theme on purpose:
// the game screen is always the dark, full-screen "arcade" look.

export const PLAY_CSS = `
.hk-root{--hk-bg:#07060f;--hk-panel:rgba(16,14,30,.78);--hk-line:rgba(255,255,255,.13);--hk-fg:#f5f3ff;--hk-muted:rgba(245,243,255,.62);
  --hk-a1:#7c5cff;--hk-a2:#22d3ee;--hk-a3:#ff4fa3;--hk-gold:#ffc83d;--hk-ok:#34d399;--hk-bad:#ff5a6a;
  position:fixed;inset:0;z-index:50;background:var(--hk-bg);color:var(--hk-fg);overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.hk-root *{box-sizing:border-box}
.hk-root button{font:inherit;color:inherit;cursor:pointer}
.hk-cam{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);filter:brightness(.55);transition:filter .6s}
.hk-cam[data-pip="1"]{inset:auto;top:96px;right:14px;width:min(260px,24vw);height:auto;aspect-ratio:16/9;border-radius:12px;border:2px solid rgba(255,255,255,.35);z-index:4;opacity:.9}
.hk-layer{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.hk-bg{z-index:1}.hk-three{position:absolute;inset:0;z-index:2;pointer-events:none}.hk-three canvas{pointer-events:none}.hk-fx{z-index:3}
.hk-glass{background:var(--hk-panel);border:1px solid var(--hk-line);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
/* HUD */
.hk-hud{position:absolute;top:14px;left:14px;right:14px;z-index:6;display:none;align-items:flex-start;gap:12px;pointer-events:none}
.hk-hud.on{display:flex}
.hk-hcard{padding:9px 15px;border-radius:14px;min-width:96px}
.hk-hcard small{display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--hk-muted);font-weight:700}
.hk-hcard b{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.hk-htitle{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}
.hk-hmid{margin:0 auto;text-align:center}
.hk-combo b{color:var(--hk-gold)}
.hk-hbar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:6px;width:160px}
.hk-hbar i{display:block;height:100%;background:linear-gradient(90deg,var(--hk-a2),var(--hk-a1));transition:width .2s}
.hk-pl{position:absolute;top:96px;z-index:6;padding:8px 14px;border-radius:14px;pointer-events:none;min-width:130px}
.hk-pl small{display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:800}
.hk-pl b{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}
.hk-pl.p0{left:14px;border-color:#2fa8ff}.hk-pl.p0 small{color:#2fa8ff}
.hk-pl.p1{right:14px;text-align:right;border-color:#ffc83d}.hk-pl.p1 small{color:#ffc83d}
.hk-btns{position:absolute;right:14px;bottom:14px;z-index:7;display:flex;gap:8px}
.hk-btns button{width:42px;height:42px;border-radius:50%;border:1px solid var(--hk-line);background:var(--hk-panel);font-size:16px;display:grid;place-items:center}
.hk-back{position:absolute;left:14px;bottom:14px;z-index:7;height:42px;padding:0 16px;border-radius:999px;border:1px solid var(--hk-line);background:var(--hk-panel);font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit}
.hk-center{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);z-index:8;font-size:clamp(48px,11vw,150px);font-weight:900;letter-spacing:-.03em;
  text-shadow:0 8px 40px rgba(0,0,0,.6);pointer-events:none;opacity:0;transition:opacity .2s,transform .25s;text-align:center;white-space:nowrap}
.hk-center.show{opacity:1;transform:translate(-50%,-50%) scale(1.04)}
.hk-center small{display:block;font-size:clamp(16px,2.4vw,26px);font-weight:600;letter-spacing:0;color:rgba(255,255,255,.85)}
.hk-toast{position:absolute;left:50%;bottom:24px;transform:translate(-50%,8px);z-index:12;padding:10px 18px;border-radius:999px;font-size:14px;opacity:0;transition:all .25s;pointer-events:none}
.hk-toast.show{opacity:1;transform:translate(-50%,0)}
.hk-sound{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:9;padding:8px 14px;border-radius:999px;font-size:13px;pointer-events:none}
/* overlays */
.hk-ov{position:absolute;inset:0;z-index:10;display:grid;place-items:center;padding:28px 18px;overflow:auto}
.hk-ov.dim{background:radial-gradient(1200px 700px at 20% 10%,rgba(124,92,255,.28),transparent 60%),radial-gradient(900px 600px at 90% 95%,rgba(34,211,238,.18),transparent 60%),rgba(7,6,15,.55)}
.hk-ov.solid{background:radial-gradient(1200px 700px at 20% 10%,rgba(124,92,255,.4),transparent 60%),radial-gradient(900px 600px at 90% 95%,rgba(255,79,163,.22),transparent 60%),var(--hk-bg)}
.hk-card{width:min(640px,100%);padding:clamp(28px,5vw,48px) clamp(20px,4vw,40px);border-radius:32px;text-align:center}
.hk-icon{display:grid;place-items:center;width:clamp(96px,15vw,132px);aspect-ratio:1;margin:0 auto 18px;border-radius:32px;font-size:clamp(54px,9vw,76px);line-height:1;
  background:linear-gradient(145deg,rgba(124,92,255,.38),rgba(34,211,238,.12));box-shadow:0 22px 50px -22px rgba(124,92,255,.8)}
.hk-tag{font-size:11.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--hk-a2);font-weight:800}
.hk-root h1{font-size:clamp(30px,6vw,60px);line-height:1;letter-spacing:-.03em;font-weight:900;margin:10px 0 14px}
.hk-root h2{font-size:clamp(22px,3.6vw,36px);letter-spacing:-.02em;font-weight:850;margin:6px 0 8px}
.hk-hrow{display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap}
.hk-hrow h1{margin:0}
.hk-icon.sm{width:clamp(64px,10vw,84px);margin:0;border-radius:24px;font-size:clamp(38px,6vw,50px)}
.hk-lead{color:rgba(255,255,255,.82);font-size:clamp(18px,2.4vw,24px);line-height:1.4;font-weight:500;max-width:34ch;margin:0 auto}
.hk-muted{color:var(--hk-muted);font-size:14.5px}
.hk-root .hk-btn{font-size:17px;font-weight:750;color:#fff;background:linear-gradient(110deg,#7c5cff,#b14fff 55%,#ff4fa3);border:0;min-height:52px;padding:14px 30px;border-radius:999px;transition:transform .15s,filter .15s;position:relative;overflow:hidden;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 14px 34px -12px rgba(124,92,255,.8)}
.hk-btn:hover{filter:brightness(1.1)}
.hk-btn:hover{transform:translateY(-1px)}
.hk-root .hk-btn.ghost{background:rgba(255,255,255,.07);color:#fff;border:1px solid var(--hk-line);box-shadow:none}
.hk-sub{margin-top:12px}
.hk-sub .hk-btn{min-height:48px;font-size:15px;padding:10px 20px}
.hk-more{margin:18px auto 0;max-width:420px;text-align:left}
.hk-more summary,.hk-guide summary{cursor:pointer;font-weight:700;list-style:none;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--hk-muted)}
.hk-more summary::-webkit-details-marker,.hk-guide summary::-webkit-details-marker{display:none}
.hk-more summary::after,.hk-guide summary::after{content:"▾";transition:transform .2s}
.hk-more[open] summary::after,.hk-guide[open] summary::after{transform:rotate(180deg)}
.hk-row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center}
.hk-big .hk-btn{min-width:220px;min-height:60px;padding:18px 30px;font-size:19px}
.hk-big .hk-sub .hk-btn{min-width:0;min-height:48px;padding:10px 20px;font-size:15px}
[data-dwell]{--p:0}
[data-dwell]::after{content:"";position:absolute;left:0;bottom:0;height:5px;width:calc(var(--p)*100%);background:linear-gradient(90deg,var(--hk-a2),var(--hk-a1));border-radius:3px}
[data-dwell].hover{outline:2px solid rgba(255,255,255,.7);transform:translateY(-2px) scale(1.015)}
.hk-guide{margin:20px auto 0;padding:6px 18px 14px;border-radius:20px;background:rgba(255,90,106,.08);border:1px solid rgba(255,90,106,.35);max-width:520px;text-align:left}
.hk-guide summary{color:#ffb3bb;justify-content:space-between;text-align:left}
.hk-guide ol{padding-left:22px;display:grid;gap:8px;font-size:15.5px;line-height:1.45}
.hk-err{color:#ff8a8a}
/* loading */
.hk-bar{height:10px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;margin:18px auto 8px;max-width:520px}
.hk-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--hk-a2),var(--hk-a1),var(--hk-a3));transition:width .3s}
.hk-pct{font-size:clamp(34px,6vw,52px);font-weight:900;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.hk-tip{min-height:44px;margin-top:12px;font-size:15.5px;color:rgba(255,255,255,.8)}
/* scan */
.hk-ring{width:160px;height:160px;margin:14px auto 8px;position:relative}
.hk-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.hk-ring .big{position:absolute;inset:0;display:grid;place-items:center;font-size:62px}
.hk-checks{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:12px 0}
.hk-checks span{padding:8px 14px;border-radius:999px;font-size:14px;background:rgba(255,255,255,.07);border:1px solid var(--hk-line)}
.hk-checks span.ok{border-color:rgba(52,211,153,.7);color:#7ee8c0}
.hk-checks span.bad{border-color:rgba(255,90,106,.7);color:#ff9aa6}
.hk-warn{min-height:24px;font-weight:700;color:var(--hk-gold);font-size:15px}
.hk-modes{display:flex;gap:8px;justify-content:center;margin:16px 0 8px}
.hk-modes button{position:relative;overflow:hidden;min-height:48px;padding:10px 18px;border-radius:14px;border:1px solid var(--hk-line);background:rgba(255,255,255,.06);font-size:14px}
.hk-modes button.on{background:rgba(124,92,255,.4);border-color:rgba(124,92,255,.9)}
/* ready / results */
.hk-rules{margin:4px auto 6px;padding-left:0;list-style:none;display:grid;gap:8px;max-width:560px;font-size:15.5px;color:rgba(255,255,255,.8);text-align:left}
.hk-rules li::before{content:"•";color:var(--hk-a2);margin-right:8px}
.hk-score{font-size:clamp(60px,12vw,116px);font-weight:900;letter-spacing:-.04em;line-height:1;margin:6px 0}
.hk-stars{font-size:42px;letter-spacing:6px;margin:4px 0 10px;color:var(--hk-gold)}
.hk-best{color:var(--hk-gold);font-weight:800;min-height:22px}
.hk-lines{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0 22px}
.hk-lines div{padding:12px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid var(--hk-line)}
.hk-lines small{display:block;font-size:11px;color:var(--hk-muted);letter-spacing:.1em;text-transform:uppercase;font-weight:700}
.hk-lines b{font-size:22px}
/* debug */
.hk-debug{position:absolute;left:10px;bottom:64px;z-index:20;padding:8px 10px;border-radius:10px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;background:rgba(0,0,0,.72);color:#9ff;pointer-events:none;max-width:min(420px,90vw)}
.hk-debug b{color:#fff}
@media (max-width:700px){.hk-hud{flex-wrap:wrap}.hk-hcard{min-width:80px;padding:7px 10px}.hk-hcard b{font-size:20px}.hk-hbar{width:110px}}
`;
