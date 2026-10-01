/**
 * Plugin stylesheet, injected once as
 * `<style data-plugin-css="dsh-session-manager/client">`.
 *
 * Colors read the official `--dsw-alias-*` tokens when present (the same
 * variables dsh-trellis uses) with fixed dark-theme fallbacks, so the panel
 * follows the official look without touching any official stylesheet.
 */
export const styles = String.raw`
.dsm-board{min-width:0;display:flex;flex-direction:column;height:100%}
.dsm-manager{min-width:0;display:flex;flex-direction:column;height:100%}
.dsm-tabs{display:flex;align-items:center;gap:6px;padding:10px 16px 0}
.dsm-manager-body{flex:1;min-height:0;display:flex;flex-direction:column}
.dsm-manager-body>.dsm-board{flex:1;min-height:0}
.dsm-pnotice{padding:6px 16px 0;font-size:12px}
.dsm-pgroup-label{width:200px;height:28px;font-size:13px;font-weight:600;flex:none}
.dsm-pcard{border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:10px;padding:8px 10px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px}
.dsm-pcard-head{display:flex;align-items:center;gap:8px}
.dsm-pcard-title{flex:1;height:30px;font-size:13px;font-weight:500}
.dsm-pcard-body{min-height:96px;font-size:12px}
.dsm-sync{max-width:640px;display:flex;flex-direction:column;gap:10px;padding:4px 0}
.dsm-sync-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-sync-label{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96);width:64px}
.dsm-sync-input{flex:1;min-width:240px;height:30px;font-size:12px}
.dsm-sync-status{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#c6c6cc);padding:6px 0}
.dsm-sync-log-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);margin-bottom:4px}
.dsm-sync-log{margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#1f1f23);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#c6c6cc);white-space:pre-wrap;word-break:break-all;max-height:240px;overflow-y:auto}
.dsm-board-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e)}
.dsm-board-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);margin-right:4px}
.dsm-board-count{font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-board-spacer{flex:1}
.dsm-board-body{flex:1;min-height:0;overflow-y:auto;padding:12px 16px}
.dsm-board-msg{padding:24px 0;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-board-msg button{margin-left:8px}
.dsm-filters{padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e);display:flex;flex-direction:column;gap:8px}
.dsm-filter-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-filter-name{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96);width:52px}
.dsm-chip{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:999px;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:12px;line-height:1.5;padding:2px 10px;cursor:pointer}
.dsm-chip:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-chip[data-on=true]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c6ef5);color:#fff}
.dsm-group{margin-bottom:16px}
.dsm-group-head{display:flex;align-items:baseline;gap:8px;padding:4px 0 8px}
.dsm-group-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec)}
.dsm-group-count{font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-quadrants{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dsm-quadrant{border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:12px;padding:10px;min-width:0}
.dsm-quadrant-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);padding:2px 4px 8px}
.dsm-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;position:relative}
.dsm-row:hover{background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-row[data-archived=true]{opacity:.55}
.dsm-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsm-row-title{font-size:13px;color:var(--dsw-alias-label-primary,#e9e9ec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-row-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-row-badges{flex:none;display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:45%}
.dsm-badge{border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-badge[data-kind=running]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c6ef5);color:#fff}
.dsm-badge[data-kind=todo]{color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-badge[data-kind=doing]{border-color:transparent;background:#2f6f4f;color:#fff}
.dsm-badge[data-kind=done]{border-color:transparent;background:#3d5a80;color:#fff}
.dsm-badge[data-kind=urgent]{border-color:transparent;background:#a23a3a;color:#fff}
.dsm-badge[data-kind=important]{border-color:transparent;background:#946b2d;color:#fff}
.dsm-badge[data-kind=archived]{border-color:transparent;background:var(--dsw-alias-bg-module-platform,#3a3a40);color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-badge[data-kind=sync]{border-color:transparent;background:var(--dsw-alias-state-success-primary,#46a758);color:#fff}
.dsm-sync-toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#e9e9ec);cursor:pointer}
.dsm-restore-form{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-restore-input{height:26px;font-size:11px;min-width:200px}
.dsm-statcards{display:flex;flex-wrap:wrap;gap:10px;padding:2px 0 12px}
.dsm-statcard{flex:1;min-width:100px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,transparent)}
.dsm-statcard-value{font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);font-variant-numeric:tabular-nums}
.dsm-statcard-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96);padding-top:2px}
.dsm-statmodel{display:flex;align-items:center;gap:8px;min-width:220px}
.dsm-sbar{flex:1;height:5px;border-radius:3px;background:var(--dsw-alias-bg-module-platform,#3a3a40);overflow:hidden;min-width:60px}
.dsm-sbar>span{display:block;height:100%;background:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-quick{flex:none;display:flex;gap:4px}
.dsm-quickbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:6px;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:11px;padding:2px 6px;cursor:pointer}
.dsm-quickbtn:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-menu{position:absolute;top:calc(100% + 2px);right:0;z-index:30;min-width:120px;background:var(--dsw-alias-bg-layer-3,#1f1f23);border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.dsm-menu button{display:block;width:100%;text-align:left;appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:12px;padding:5px 8px;border-radius:6px;cursor:pointer}
.dsm-menu button:hover{background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-menu button[data-selected=true]{color:var(--dsw-alias-label-primary,#e9e9ec);font-weight:600}
.dsm-dialog-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.dsm-dialog-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#e9e9ec)}
.dsm-pill-row{display:flex;flex-wrap:wrap;gap:6px}
.dsm-pill{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:999px;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:12px;padding:3px 12px;cursor:pointer}
.dsm-pill:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-pill[data-on=true]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c6ef5);color:#fff}
.dsm-pill[data-indent=true]{margin-left:16px}
.dsm-input{box-sizing:border-box;width:100%;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#1f1f23);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#e9e9ec);height:34px}
.dsm-textarea{box-sizing:border-box;width:100%;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#1f1f23);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#e9e9ec);min-height:64px;resize:vertical}
.dsm-input:focus-visible,.dsm-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-dialog-error{font-size:12px;color:var(--dsw-alias-label-error,#e5484d);min-height:16px}
.dsm-dialog-footer{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dsm-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;cursor:pointer;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-btn:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-btn[data-primary=true]{border-color:transparent;background:var(--dsw-alias-label-primary,#e9e9ec);color:var(--dsw-alias-bg-layer-3,#1f1f23)}
.dsm-btn:disabled{opacity:.45;cursor:default}
.dsm-btn-danger{color:var(--dsw-alias-label-error,#e5484d)}
.dsm-rowaction{appearance:none;border:0;background:none;color:var(--dsw-alias-label-tertiary,#8f8f96);cursor:pointer;padding:2px;border-radius:6px;display:inline-flex;align-items:center}
.dsm-rowaction:hover{color:var(--dsw-alias-label-primary,#e9e9ec);background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-settings-body{max-width:560px;display:flex;flex-direction:column;gap:12px;padding:14px 2px}
.dsm-settings-intro{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-settings-note{font-size:13px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-settings-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8f8f96);word-break:break-all}
.dsm-settings-saved{font-size:12px;color:var(--dsw-alias-state-success-primary,#46a758)}
.dsm-tcard{border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:10px;margin-bottom:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,transparent)}
.dsm-tcard-head{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:9px 12px;background:none;border:0;cursor:pointer;text-align:left;font:inherit}
.dsm-tcard-head:hover{background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-tcard-title{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-tcard-progress{flex:none;display:flex;align-items:center;gap:6px}
.dsm-tcard-bar{display:inline-block;width:72px;height:6px;border-radius:3px;background:var(--dsw-alias-bg-module-platform,#3a3a40);overflow:hidden}
.dsm-tcard-bar>span{display:block;height:100%;background:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-tcard-count{font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96);font-variant-numeric:tabular-nums}
.dsm-chev{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#8f8f96);transition:transform .15s ease}
.dsm-tcard[data-open=true] .dsm-chev{transform:rotate(90deg)}
.dsm-tcard-body{padding:2px 12px 10px;overflow-x:auto}
.dsm-ttable{width:100%;border-collapse:collapse;font-size:12px}
.dsm-ttable th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary,#8f8f96);padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e);white-space:nowrap}
.dsm-ttable td{padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#222226);color:var(--dsw-alias-label-secondary,#c6c6cc);vertical-align:top}
.dsm-ttable tr:last-child td{border-bottom:0}
.dsm-ttable code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-ttable a{color:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-twarn{font-size:12px;color:var(--dsw-alias-label-warning,#f5A623);padding:2px 0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-tstandalone{padding:6px 0 2px}
.dsm-tstandalone-list{padding:4px 0 0}
.dsm-search{width:180px;flex:none;height:28px;font-size:12px;padding:0 10px}
.dsm-tsessions{display:flex;flex-wrap:wrap;gap:4px;padding:0 12px 8px}
.dsm-tsession{appearance:none;background:none;font:inherit;cursor:pointer;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.dsm-tsession:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-tsession:disabled{opacity:.55;cursor:default}
.dsm-ttable .dsm-tsession{display:inline-block;max-width:180px;margin:1px 4px 1px 0;vertical-align:middle}
.dsm-texport{padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e);display:flex;flex-direction:column;gap:8px}
.dsm-texport-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-texport-label{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96);width:60px}
.dsm-texport-input{flex:1;min-width:220px;height:30px;font-size:12px}
.dsm-tmeta{font-size:12px;color:var(--dsw-alias-label-secondary,#c6c6cc);word-break:break-all}
.dsm-tmsg-ok{font-size:12px;color:var(--dsw-alias-state-success-primary,#46a758);word-break:break-all}
`;
