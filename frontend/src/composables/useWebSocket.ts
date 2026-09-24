// ============================================================================
// useWebSocket.ts —— WebSocket 连接管理（自动重连 + JSON 消息分发）
//
// 注意：此组合式函数在 Pinia store 的 setup 中调用（无组件实例），
// 因此不注册 onUnmounted，连接生命周期跟随 store 存活。
// ============================================================================

import { ref } from 'vue'

export interface UseWebSocketOptions {
  url: string
  onMessage: (msg: any) => void
  onOpen?: () => void
  onClose?: () => void
}

export function useWebSocket(options: UseWebSocketOptions) {
  const connected = ref(false)
  const connecting = ref(false)
  let ws: WebSocket | null = null
  let reconnectTimer: number | null = null
  let shouldReconnect = true

  function connect() {
    if (connecting.value) return
    connecting.value = true
    try {
      ws = new WebSocket(options.url)
    } catch (e) {
      connecting.value = false
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      connected.value = true
      connecting.value = false
      options.onOpen?.()
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string)
        options.onMessage(msg)
      } catch (e) {
        console.warn('[WS] 消息解析失败:', ev.data, e)
      }
    }

    ws.onclose = () => {
      connected.value = false
      connecting.value = false
      options.onClose?.()
      scheduleReconnect()
    }

    ws.onerror = () => {
      connected.value = false
      connecting.value = false
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    if (reconnectTimer) return
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 1500)
  }

  function send(payload: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
      return true
    }
    return false
  }

  function close() {
    shouldReconnect = false
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
    connected.value = false
  }

  connect()

  return { connected, connecting, send, close }
}
