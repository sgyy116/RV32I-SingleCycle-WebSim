import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.cwd())
const layoutPath = path.join(root, 'frontend', 'src', 'data', 'datapathLayout.json')
const highlightPath = path.join(root, 'frontend', 'src', 'data', 'datapathHighlight.ts')
const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
const highlight = fs.readFileSync(highlightPath, 'utf8')

const taken = layout.modules.find((module) => module.id === 'taken')
if (!taken) throw new Error('缺少通用 taken 模块')

const portIds = layout.ports.filter((port) => port.module === 'taken').map((port) => port.id)
if (!portIds.includes('taken.branch_in')) {
  throw new Error(`taken 缺少通用 branch_in 端口，实际端口：${portIds.join(', ')}`)
}
if (portIds.includes('taken.beq_in')) throw new Error('taken 仍保留 BEQ 专用端口')

const branchWire = layout.wires.find((wire) => wire.id === 'w_dec_branch')
if (!branchWire || branchWire.to !== 'taken.branch_in') {
  throw new Error('译码器到 taken 的通用条件分支连线不完整')
}
if (layout.wires.some((wire) => wire.id === 'w_dec_beq')) throw new Error('仍保留 BEQ 专用连线')
if (highlight.includes("'w_dec_beq'")) throw new Error('高亮规则仍使用 BEQ 专用连线名')
if (layout.wires.find((wire) => wire.id === 'w_taken_m4')?.signal !== 'state.branch.taken') {
  throw new Error('taken 输出没有绑定到后端通用 branch.taken')
}

console.log('前端条件分支语义回归通过：taken 使用通用 branch 输入与 branch.taken 输出')
