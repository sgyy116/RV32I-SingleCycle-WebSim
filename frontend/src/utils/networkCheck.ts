export interface NetworkResult {
  latencyMs: number
  downloadMbps: number
  uploadMbps: number
  shortSample: boolean
}

/** 小样本的应用传输速率，包含 HTTP 开销，不等同于运营商线路峰值。 */
export async function checkNetwork(signal: AbortSignal, onProgress: (stage: string) => void = () => {}): Promise<NetworkResult> {
  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`/api/network/${path}`, { ...options, signal, cache: 'no-store' })
    if (!response.ok) throw new Error(response.status === 429 ? '检测繁忙，请稍后重试' : `网络检测失败（${response.status}）`)
    return response
  }
  const round = (value: number) => Math.round(value * 100) / 100
  const mbps = (bytes: number, milliseconds: number) => round(bytes * 8 / (Math.max(1, milliseconds) * 1000))
  onProgress('正在检测延迟…')
  const timings: number[] = []
  for (let index = 0; index < 3; index++) {
    const start = performance.now()
    const result = await (await request('ping')).json()
    if (result.ok !== true) throw new Error('服务器检测响应无效')
    timings.push(performance.now() - start)
  }
  timings.sort((a, b) => a - b)

  onProgress('正在检测下载…')
  const downloadStart = performance.now()
  const data = await (await request('download?size=1048576')).arrayBuffer()
  const downloadTime = performance.now() - downloadStart
  if (data.byteLength !== 1048576) throw new Error('下载检测数据不完整，请重试')

  onProgress('正在检测上传…')
  const upload = new Uint8Array(262144)
  for (let index = 0; index < upload.length; index += 65536) {
    crypto.getRandomValues(upload.subarray(index, index + 65536))
  }
  const uploadStart = performance.now()
  const result = await (await request('upload', { method: 'POST', body: upload,
    headers: { 'Content-Type': 'application/octet-stream' } })).json()
  const uploadTime = performance.now() - uploadStart
  if (result.bytes !== upload.byteLength) throw new Error('上传检测数据不完整，请重试')
  return {
    latencyMs: round(timings[1]), downloadMbps: mbps(data.byteLength, downloadTime),
    uploadMbps: mbps(upload.byteLength, uploadTime),
    shortSample: downloadTime < 100 || uploadTime < 100,
  }
}
