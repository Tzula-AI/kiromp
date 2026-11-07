export const CSS = `
.oa-root { display: flex; height: 100%; min-height: 0; min-width: 0; overflow: hidden; color: var(--text); font-family: var(--font-body, inherit); }
.oa-main { flex: 1; min-width: 0; overflow-y: auto; }
.oa-body { padding: 0 24px 24px; }
.oa-kpis { display: grid; gap: 12px; margin-bottom: 16px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.oa-grid2 { display: grid; gap: 16px; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); margin-bottom: 16px; }
@media (max-width: 1024px) { .oa-grid2 { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) { .oa-body { padding: 0 16px 16px; } }
.oa-section { display: flex; align-items: center; gap: 8px; margin: 20px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.oa-count { padding: 0 7px; border-radius: 999px; background: var(--bg-hover); font-variant-numeric: tabular-nums; }
.oa-card-flush { padding-left: 0 !important; padding-right: 0 !important; overflow-x: auto; }
.oa-card-title-pad { padding: 0 20px; }
.oa-muted { color: var(--muted); }
.oa-mono { font-family: var(--mono, ui-monospace, monospace); }
.oa-empty { padding: 24px 0; text-align: center; font-size: 13px; color: var(--muted); }
.oa-error { margin-bottom: 16px; padding: 10px 14px; border: 1px solid var(--danger); border-radius: 8px; background: var(--danger-subtle); color: var(--danger); font-size: 13px; }

.oa-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.oa-table th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); white-space: nowrap; }
.oa-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; }
.oa-table tbody tr:last-child td { border-bottom: 0; }
.oa-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.oa-table tr.oa-click { cursor: pointer; }
.oa-table tr.oa-click:hover td { background: var(--bg-hover); }
.oa-table tr[data-selected='true'] td { background: var(--accent-subtle); }
.oa-trunc { display: block; max-width: 224px; overflow: hidden; text-overflow: ellipsis; }
.oa-name { display: block; max-width: 288px; overflow: hidden; text-overflow: ellipsis; padding: 0; border: 0; background: none; color: var(--text-strong); font: inherit; font-weight: 500; text-align: left; cursor: pointer; }
.oa-name:hover { color: var(--accent); }
.oa-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex: none; }
.oa-inline { display: inline-flex; align-items: center; gap: 8px; }
.oa-models { display: flex; flex-wrap: wrap; gap: 4px; max-width: 256px; }
.oa-pulse { animation: oa-pulse 1.4s ease-in-out infinite; }
@keyframes oa-pulse { 50% { opacity: .35; } }

.oa-donut { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; min-width: 0; }
.oa-donut-ring { position: relative; flex: none; }
.oa-donut-ring svg { width: 128px; height: 128px; transform: rotate(-90deg); }
.oa-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
.oa-donut-total { font-size: 24px; font-weight: 700; line-height: 1; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.oa-donut-label { margin-top: 4px; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--muted); }
.oa-legend { display: flex; flex: 1; min-width: 176px; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12px; }
.oa-legend li { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0 -4px; padding: 0 4px; border-radius: 4px; }
.oa-legend li[data-hover='true'] { background: var(--bg-hover); }
.oa-legend .oa-legend-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oa-legend .oa-legend-n { margin-left: auto; padding-left: 12px; color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }

.oa-tl { display: flex; gap: 8px; min-width: 0; }
.oa-tl-axis { position: relative; width: 24px; flex: none; text-align: right; font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.oa-tl-axis span { position: absolute; right: 0; line-height: 1; }
.oa-tl-plot { position: relative; flex: 1; min-width: 0; }
.oa-tl-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.oa-tl-ticks { position: relative; height: 14px; margin: 4px 0 0 32px; font-size: 10px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.oa-tl-ticks span { position: absolute; top: 0; }
.oa-tip { position: absolute; top: 4px; z-index: 10; max-width: 100%; padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); box-shadow: var(--shadow-lg); font-size: 11px; white-space: nowrap; pointer-events: none; }
.oa-tip-row { display: flex; align-items: center; gap: 6px; }
.oa-tip-row b { margin-left: auto; padding-left: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }

.oa-drawer { display: flex; flex: none; flex-direction: column; width: 520px; max-width: 100%; min-height: 0; border-left: 1px solid var(--border); background: var(--panel, var(--bg)); }
.oa-drawer-mobile { width: 100%; border-left: 0; }
.oa-drawer-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.oa-drawer-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--text-strong); }
.oa-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
.oa-btn:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.oa-drawer-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.oa-transcript { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 12px; padding: 12px 16px; overflow-y: auto; }
.oa-msg { display: flex; gap: 8px; min-width: 0; }
.oa-msg-icon { flex: none; margin-top: 3px; }
.oa-msg-body { flex: 1; min-width: 0; }
.oa-msg-meta { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.oa-msg-text { margin-top: 2px; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.oa-msg-user { padding: 6px 8px; border-radius: 6px; background: var(--accent-subtle); }
.oa-call { font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; color: var(--muted-strong, var(--muted)); }
.oa-tool-out { margin: 2px 0 0; padding: 6px 8px; max-height: 192px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
.oa-live { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.oa-live .oa-btn { margin-left: auto; padding: 0 6px; font-size: 11px; }
`
