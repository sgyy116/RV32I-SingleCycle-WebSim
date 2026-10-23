<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { NModal } from 'naive-ui'
import { checkNetwork, type NetworkResult } from '@/utils/networkCheck'

const open = ref(false)
const running = ref(false)
const stage = ref('')
const error = ref('')
const result = ref<NetworkResult | null>(null)
let controller: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const advice = computed(() => {
  if (!result.value) return ''
  if (result.value.latencyMs > 500 || result.value.downloadMbps < 5) {
    return '当前网络较慢，可能影响页面加载和操作响应。可切换网络后重试。'
  }
  return '本次检测连接正常；实际体验还受网络波动和服务器负载影响。'
})

function cancel() { controller?.abort() }
async function start() {
  if (running.value) return
  running.value = true
  result.value = null
  error.value = ''
  const current = new AbortController()
  controller = current
  let timedOut = false
  timer = setTimeout(() => { timedOut = true; current.abort() }, 30000)
  try {
    result.value = await checkNetwork(current.signal, value => { stage.value = value })
  } catch (cause) {
    error.value = current.signal.aborted ? (timedOut ? '检测超时，请检查网络后重试' : '检测已取消')
      : cause instanceof Error ? cause.message : '检测失败，请重试'
  } finally {
    if (timer !== null) clearTimeout(timer)
    timer = null
    controller = null
    running.value = false
    stage.value = ''
  }
}
function close() { cancel(); open.value = false }
onUnmounted(cancel)
</script>

<template>
  <button type="button" class="network-trigger" @click="open = true">网络检测</button>
  <n-modal :show="open" preset="card" title="网络检测" class="network-dialog"
    :style="{ width: 'min(460px, calc(100vw - 32px))' }" :on-close="close"
    @update:show="value => { if (!value) close() }">
    <p class="network-description">检测到本实验服务器的连接，约消耗 1.3 MB 流量。</p>
    <div role="status" aria-live="polite" class="network-result">
      <p v-if="running">{{ stage }}</p>
      <p v-else-if="error" class="network-error">{{ error }}</p>
      <template v-else-if="result">
        <dl>
          <div><dt>延迟</dt><dd>{{ result.latencyMs.toFixed(0) }} ms</dd></div>
          <div><dt>下载</dt><dd>{{ result.downloadMbps.toFixed(2) }} Mbps</dd></div>
          <div><dt>上传</dt><dd>{{ result.uploadMbps.toFixed(2) }} Mbps</dd></div>
        </dl>
        <p>{{ advice }}</p>
        <p v-if="result.shortSample" class="network-note">传输样本较短，速率仅供参考。</p>
      </template>
      <p v-else>点击开始检测，测量下载、上传速度和响应延迟。</p>
    </div>
    <p class="network-note">结果反映本次应用传输速度；5 Mbps 为初步参考值，最低要求仍待部署验证。</p>
    <div class="network-actions">
      <button v-if="running" type="button" @click="cancel">取消检测</button>
      <button v-else type="button" class="network-start" @click="start">{{ result || error ? '重新检测' : '开始检测' }}</button>
    </div>
  </n-modal>
</template>

<style scoped>
.network-trigger { flex-shrink: 0; padding: 3px 8px; border: 1px solid #94a3b8; border-radius: 5px; color: #f8fafc; background: transparent; cursor: pointer; white-space: nowrap; }
.network-trigger:hover { background: #334155; }
button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
.network-description, .network-note { color: #64748b; font-size: 12px; }
.network-result { margin-block: 16px; min-height: 100px; color: #334155; }
.network-result dl { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.network-result dt { font-size: 12px; color: #64748b; }
.network-result dd { margin: 4px 0 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.network-error { color: #b91c1c; }
.network-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.network-actions button { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 14px; cursor: pointer; background: #fff; }
.network-actions .network-start { background: #2563eb; color: #fff; border-color: #2563eb; }
</style>
