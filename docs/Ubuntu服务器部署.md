# Ubuntu 服务器部署（v1.5.2）

目标配置：4 vCPU、8 GB 内存、200 GB 磁盘，外部只开放 TCP 80/443。需要一条解析到服务器的域名记录，以及服务器 SSH 权限。以下命令在服务器执行；将 `YOUR_DOMAIN` 换成实际域名。仓库代码、前端和 C++ 核心应使用同一个提交构建。

## 1. 安装与构建

```bash
sudo apt update
sudo apt install -y git g++ python3 python3-venv nginx
sudo useradd --system --home /opt/rv32i --shell /usr/sbin/nologin rv32i
sudo git clone --branch v1.5.2 --depth 1 https://github.com/sgyy116/RV32I-SingleCycle-WebSim.git /opt/rv32i
sudo chown -R "$USER":"$USER" /opt/rv32i
cd /opt/rv32i
```

```bash
cd /opt/rv32i
python3 -m venv .venv
.venv/bin/pip install -r backend/python/requirements.txt
sudo apt install -y nodejs npm  # 仅在服务器上构建前端时需要
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build
mkdir -p backend/cpp/build
g++ -std=c++17 -O2 -I backend/cpp/src backend/cpp/src/main.cpp backend/cpp/src/rv_core.cpp backend/cpp/src/rv_disasm.cpp -o backend/cpp/build/rv32i_sim
sudo chown -R rv32i:rv32i /opt/rv32i
```

在学校服务器上若已安装较旧 Node.js，先确认 `node --version` 为 18 或更高。交付时可以在本地构建前端并传输 `frontend/dist`，服务器运行阶段不需要 Node.js。`riscv-none-elf-gcc` 是可选工具；未安装时使用项目内置汇编器。

### 首次安装的快速路径

依赖下载通常比本项目的 C++ 编译耗时。当前前端 `node_modules` 约 222 MB，构建后的 `frontend/dist` 约 1.2 MB。若本地已完成前端构建，在**本地电脑**传输构建产物：

```bash
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build
rsync -av frontend/dist/ 登录名@服务器地址:/opt/rv32i/frontend/dist/
```

服务器端可跳过 `npm ci` 和 `npm run build`，也无需安装 Node.js/npm；仍需在服务器上创建 Python 虚拟环境、安装 Python 依赖并编译 C++ 核心。不要直接拷贝本机 `.venv` 或 C++ 可执行文件，避免操作系统和架构差异。若 Python 包下载慢，可在安装命令后加 `-i https://pypi.tuna.tsinghua.edu.cn/simple`；镜像可用性依所在网络而定。后续仅改前端时，重新构建并传输 `frontend/dist` 即可。

## 2. 后端常驻运行

```bash
sudo cp deploy/rv32i.service /etc/systemd/system/rv32i.service
sudo systemctl daemon-reload
sudo systemctl enable --now rv32i
sudo systemctl status rv32i
curl -I http://127.0.0.1:8081/
```

后端 Python 进程同时提供 8081 上的页面和 8080 上的 WebSocket；每个 WebSocket 会话使用独立的 C++ 模拟器进程。systemd 将两端口限定在 `127.0.0.1`，外网不需要开放 8080/8081。日志使用 `sudo journalctl -u rv32i -f` 查看。服务以 `RV32I_SERVER_MODE=1` 运行，此模式关闭 HTTP 编译接口及客户端指定服务器文件路径的加载入口，页面经 `/ws` 在各自会话中编译和加载。

## 3. Nginx 与 HTTPS

```bash
sudo sed 's/YOUR_DOMAIN/实际域名/g' deploy/rv32i.nginx.conf | sudo tee /etc/nginx/sites-available/rv32i.conf >/dev/null
sudo ln -s /etc/nginx/sites-available/rv32i.conf /etc/nginx/sites-enabled/rv32i.conf
sudo nginx -t
sudo systemctl reload nginx
```

先确认 `http://实际域名/` 可打开，并且浏览器开发工具中 `/ws` 返回 `101 Switching Protocols`。域名 DNS 和 80/443 防火墙规则就绪后，在 [Certbot 官方说明](https://certbot.eff.org/instructions)中选择服务器实际 Ubuntu 版本及 Nginx，完成安装后运行 `sudo certbot --nginx -d 实际域名`。它会给 Nginx 配置证书及 HTTP 到 HTTPS 的跳转。HTTPS 页面会自动改用 `wss://实际域名/ws`，无须额外开放 WebSocket 端口；WebSocket 升级头配置依据 [Nginx 官方说明](https://nginx.org/en/docs/http/websocket.html)。

## 4. 部署后检查

```bash
curl -I https://实际域名/
sudo ss -lntp | grep -E ':(80|443|8080|8081)'
sudo systemctl status rv32i nginx
```

用浏览器打开站点，编译并单步执行一段短程序，确认“连接成功”、加载及寄存器更新。100 人并发测试应从另一台机器发起，安装 `aiohttp`、`websockets` 后执行：

```bash
python3 -m pip install 'aiohttp>=3.9' 'websockets>=12'
python3 tools/load_test_100.py --url https://实际域名/ --users 100 --hold 30 --source-file backend/asm_examples/fibonacci.s
```

脚本先让全部用户访问页面并收到 WebSocket `ready`，再统一释放 100 个 `load` 编译请求，收到 `loaded` 后各执行一步，并保持连接 30 秒。输出包括编译前就绪人数、编译请求发出时间跨度、编译并加载的平均/P95/最大耗时、完成单步人数和失败数；若峰值连接或完成数不足 100、有错误则返回非零状态。`--source-file` 应选用实际课程中的典型程序，也可再用更长的真实程序复测；不要只测默认的三条短指令。测试前用 `command -v riscv-none-elf-gcc` 核对本机与目标服务器是否使用相同编译器路径，否则结果不能直接比较。

测试时在服务器同时观察 `top`、`free -h`、`ps -C rv32i_sim | wc -l` 和 `journalctl -u rv32i`，记录错误率、P95 延迟、CPU、内存和进程数。分三轮重复测试并保留每轮结果；通过标准至少包括 100 人全部加载、单步成功且没有 OOM 或服务重启，延迟目标需按教学使用要求确定。4 核 8 GB 是申请规格，不能单凭规格保证 100 个活跃会话的性能；必须以目标服务器上的实测结果为准。

## 5. 本地 Ubuntu 预演

可以先在本地 Ubuntu 安装并运行同一份源码；若 Ubuntu 是虚拟机，尽量分配与目标服务器相同的 4 vCPU、8 GB 内存。在 Ubuntu 上检出 v1.5.2：

```bash
git clone --branch v1.5.2 --depth 1 https://github.com/sgyy116/RV32I-SingleCycle-WebSim.git ~/rv32i
```

若前端已经在 Fedora 上构建，可将 `frontend/dist` 传到 Ubuntu，避免在 Ubuntu 上安装 Node.js/npm；不要传输 Fedora 的虚拟环境或 C++ 二进制。在 Fedora 项目目录执行：

```bash
rsync -av frontend/dist/ 登录名@Ubuntu地址:~/rv32i/frontend/dist/
```

随后在 Ubuntu 上执行：

```bash
sudo apt update && sudo apt install -y g++ python3 python3-venv
cd ~/rv32i
python3 -m venv .venv
.venv/bin/pip install -r backend/python/requirements.txt
mkdir -p backend/cpp/build
g++ -std=c++17 -O2 -I backend/cpp/src backend/cpp/src/main.cpp backend/cpp/src/rv_core.cpp backend/cpp/src/rv_disasm.cpp -o backend/cpp/build/rv32i_sim
```

然后在一个终端运行：

```bash
RV32I_SERVER_MODE=1 RV32I_BIND_HOST=127.0.0.1 .venv/bin/python -B backend/python/server.py
```

v1.5.2 已直接提供 8081 的同源 `/ws`。浏览器打开 `http://127.0.0.1:8081/` 即可联调；在第二个终端执行直连测试：

```bash
.venv/bin/python -B tools/load_test_100.py --url http://127.0.0.1:8081/ --users 100 --hold 30 --source-file backend/asm_examples/fibonacci.s
```

这能检查 Ubuntu 环境下 100 个会话是否同时发起编译、完成加载和单步。若要验证正式部署链路，应先配置本机 Nginx，然后将 `--url` 指向 Nginx 的地址并去掉 `--ws-url`。压测客户端与服务进程同机运行会争用 CPU 和内存；性能验收应在目标服务器上运行服务、在另一台机器发起测试。
