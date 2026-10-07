/** @type {import('tailwindcss').Config} */
export default {
  // 独立预览从仓库根启动，扫描路径必须相对配置文件而非进程工作目录。
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  },
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
