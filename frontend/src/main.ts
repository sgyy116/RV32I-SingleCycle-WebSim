import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
// 数据通路高亮的样式。离线核对脚本 tools/hl_preview.mjs 会内联读同一个文件，
// 所以网页端和截图核对看到的效果必然一致。
import './styles/datapath.css'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
