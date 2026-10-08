export type WorkspaceMode = 'wide' | 'stacked' | 'single'
export type WorkspacePanel = 'datapath' | 'editor' | 'state'

/** 宽高比使用整个浏览器内容视口，避免顶底栏换行反过来触发布局切换。 */
export function resolveWorkspaceMode(width: number, height: number, current?: WorkspaceMode): WorkspaceMode {
  const ratio = width / Math.max(1, height)
  if (!current) return width < 800 ? 'single' : width >= 1000 && ratio >= 4 / 3 ? 'wide' : 'stacked'
  if (current === 'wide') return width < 760 ? 'single' : width < 960 || ratio < 1.30 ? 'stacked' : 'wide'
  if (current === 'single' && width < 840) return 'single'
  if (width < 760) return 'single'
  // 宽度与比例均留缓冲，拖动窗口越过临界点时不反复跳动。
  return width >= 1040 && ratio >= 1.36 ? 'wide' : 'stacked'
}
