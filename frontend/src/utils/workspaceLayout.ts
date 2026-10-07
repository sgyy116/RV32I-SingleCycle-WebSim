export type WorkspaceMode = 'wide' | 'stacked' | 'single'
export type WorkspacePanel = 'datapath' | 'editor' | 'state'

/** 按可用宽度重排；往返阈值错开，防止窗口在临界点附近拖动时反复切换。 */
export function resolveWorkspaceMode(width: number, current?: WorkspaceMode): WorkspaceMode {
  if (!current) return width < 800 ? 'single' : width < 1360 ? 'stacked' : 'wide'
  if (current === 'wide') return width < 760 ? 'single' : width < 1320 ? 'stacked' : 'wide'
  if (current === 'single') return width >= 1400 ? 'wide' : width >= 840 ? 'stacked' : 'single'
  return width < 760 ? 'single' : width >= 1400 ? 'wide' : 'stacked'
}
