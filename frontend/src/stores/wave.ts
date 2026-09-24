// ============================================================================
// wave.ts —— 信号逐波传播的播放状态（Pinia）
//
// 这是「动画」这件事的唯一状态源。它自己持有一个 setTimeout 链，不碰
// simulator 的定时器——两个定时器同时往 WebSocket 发 step 会打架。
//
// 三个按钮的语义（用户原话）：
//   【单条指令】把这条指令的十来波按顺序流动播一遍，速度随时可调。
//   【单步】    屏幕上前进一波。若这条已全部点亮，就执行下一条并亮它第 1 波。
//   【运行】    连续执行：每条指令都按设定速度流动播，播完自动走下一拍。
//
// 关键点：sim.step() 是 WebSocket 往返，**异步**。所以「需要后端走一拍」的动作
// 不能直接改 index，得挂一个 pending 标记，等新的 cycleState 到了再动画面。
// 这就是下面 pending 存在的全部理由。
//
// 中途拖速度滑块要立刻生效：定时器用 setTimeout 自递归、每拍重读 speed，
// 而不是 setInterval 固定间隔（那样改速就得重建定时器，每拖一下就重置节奏）。
// ============================================================================

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSimulatorStore } from './simulator'
import { computeHighlight } from '@/data/datapathHighlight'
import {
  computeWaves, sliceHighlight, freshWires, gateOf, emptyPlan,
  type WavePlan,
} from '@/data/datapathWave'
import type { DatapathLayout } from '@/data/datapathScene'
import layoutJson from '@/data/datapathLayout.json'

const LAYOUT = layoutJson as unknown as DatapathLayout

/** 等新 cycleState 到达后要做什么 */
type Pending = '' | 'one' | 'play'

export const useWaveStore = defineStore('wave', () => {
  const sim = useSimulatorStore()

  // ---------------- 播放状态 ----------------
  /** 已点亮的波数。0 = 除恒亮模块外全暗；total = 这条指令全亮 */
  const index = ref(0)
  /** 定时器在跑（自动推波） */
  const playing = ref(false)
  /** 连续执行模式：播完这条接着走下一条。【单条指令】不开，【运行】开 */
  const continuous = ref(false)
  /** 流动速度，单位「波/秒」 */
  const speed = ref(5)

  let timer: number | null = null
  let pending: Pending = ''

  // ---------------- 派生 ----------------
  /** 完整高亮（未切片）。DatapathView 和各面板都读这里，避免各自算一遍 */
  const raw = computed(() => computeHighlight(sim.cycleState, LAYOUT))
  const plan = computed<WavePlan>(() =>
    sim.cycleState ? computeWaves(raw.value, LAYOUT) : emptyPlan(),
  )
  const total = computed(() => plan.value.count)
  /** 按当前波次切出来的高亮——这是图上真正显示的东西 */
  const shown = computed(() => sliceHighlight(raw.value, plan.value, index.value))
  /** 本波「新生」的连线，用来做虚线流动 */
  const fresh = computed(() => freshWires(raw.value, plan.value, index.value))
  /** 右侧面板各卡片的开关 */
  const gates = computed(() => gateOf(plan.value, index.value))
  /** 当前正在第几波（1 基，给人看的） */
  const waveNo = computed(() => Math.min(index.value, total.value))
  const atEnd = computed(() => index.value >= total.value)

  // ---------------- 定时器 ----------------
  function stopTimer() {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  /** 掐掉自动播放（单步 / 暂停 / 复位 / 换指令时都要先做这一步） */
  function cancel() {
    stopTimer()
    playing.value = false
    continuous.value = false
  }

  function schedule() {
    stopTimer()
    playing.value = true
    // 每拍重读 speed：中途改速下一拍就生效，不用重建定时器
    const ms = Math.max(16, 1000 / Math.max(0.5, speed.value))
    timer = window.setTimeout(tick, ms)
  }

  function tick() {
    timer = null
    if (index.value < total.value) index.value++
    if (index.value >= total.value) finishInstruction()
    else schedule()
  }

  /** 一条指令播到头了：连续模式就走下一拍，否则停下停在「全亮」态 */
  function finishInstruction() {
    if (continuous.value && !sim.isHalted) {
      // 定时器停掉（等后端回包期间画面不动），但 playing 保持为真——
      // 它表示的是「正在自动播放」这件持续的事，含等后端那一小段。
      // 若在这里置假，「运行」会在两条指令的间隙里闪回可点状态，点下去多发一拍。
      stopTimer()
      pending = 'play'
      sim.step()
    } else {
      cancel()
    }
  }

  // ---------------- 三个按钮 ----------------
  /** 【单步】前进一波；已全亮就执行下一条并亮它第 1 波 */
  function stepWave() {
    if (!sim.connected || sim.isHalted) return
    cancel()
    if (!atEnd.value) {
      index.value++
      return
    }
    pending = 'one'
    sim.step()
  }

  /** 【单条指令】把这条指令剩下的波播完 */
  function playInstruction() {
    if (!sim.connected || sim.isHalted) return
    cancel()
    if (!atEnd.value) {
      schedule()
      return
    }
    pending = 'play'
    sim.step()
  }

  /** 【运行】连续执行，每条都按设定速度流动播 */
  function startRun() {
    if (!sim.connected || sim.isHalted) return
    cancel()
    if (!atEnd.value) {
      continuous.value = true
      schedule()
      return
    }
    continuous.value = true
    pending = 'play'
    sim.step()
  }

  /** 【暂停】停在当前波，并顺手告诉后端别继续跑 */
  function pause() {
    cancel()
    sim.pause()
  }

  /** 【复位】/ 换程序：回到一波都没亮 */
  function resetWaves() {
    cancel()
    pending = ''
    index.value = 0
  }

  // ---------------- 新周期到达 ----------------
  watch(
    () => sim.cycleState,
    () => {
      if (!sim.cycleState) {
        resetWaves()
        return
      }
      const p = pending
      pending = ''
      if (p === 'one') {
        // 后端刚走完一拍：亮它第 1 波，停在那儿等学生再点
        index.value = Math.min(1, total.value)
      } else if (p === 'play') {
        // 先亮第 1 波再往下播。连续模式下播到这条末尾时 finishInstruction 会再走一拍
        index.value = Math.min(1, total.value)
        schedule()
      } else {
        // 翻历史 / 首次加载 / 外部触发：不播动画，直接全亮
        index.value = total.value
      }
    },
  )

  // 刻意不监听 sim.isHalted 去 cancel()：后端停机时是「先发 cycle_state、再发 halted」，
  // 两个 watch 在同一批里触发，cancel 会把**最后一条指令**的动画当场掐死。
  // 停不停由 finishInstruction 自己判断（它检查 !sim.isHalted），不需要外部插手。

  return {
    index, playing, continuous, speed,
    raw, plan, total, shown, fresh, gates, waveNo, atEnd,
    stepWave, playInstruction, startRun, pause, resetWaves,
  }
})
