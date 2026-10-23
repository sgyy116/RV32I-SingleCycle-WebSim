"""有界、不可缓存的项目服务器网络检测端点。"""
import asyncio
import os

from aiohttp import web

# 随机内容避免压缩夸大下载速率；同一缓冲区复用，不按请求分配大文件。
PAYLOAD = os.urandom(2 * 1024 * 1024)
HEADERS = {'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff'}
MAX_UPLOAD = 512 * 1024


def register_network_routes(app):
    active = 0

    async def ping(request):
        return web.json_response({'ok': True}, headers=HEADERS)

    async def download(request):
        nonlocal active
        try:
            size = int(request.query.get('size', '1048576'))
            if size not in (65536, 262144, 1048576, 2097152):
                raise ValueError()
        except ValueError:
            raise web.HTTPBadRequest(text='检测数据大小无效', headers=HEADERS)
        if active >= 4:
            raise web.HTTPTooManyRequests(text='检测繁忙，请稍后重试', headers=HEADERS)
        active += 1
        try:
            response = web.StreamResponse(headers={**HEADERS, 'Content-Type': 'application/octet-stream',
                                                   'Content-Length': str(size)})

            async def transfer():
                await response.prepare(request)
                for offset in range(0, size, 65536):
                    await response.write(PAYLOAD[offset:offset + 65536])
                await response.write_eof()
            await asyncio.wait_for(transfer(), timeout=10)
            return response
        finally:
            active -= 1

    async def upload(request):
        nonlocal active
        if active >= 4:
            raise web.HTTPTooManyRequests(text='检测繁忙，请稍后重试', headers=HEADERS)
        if request.content_length is not None and request.content_length > MAX_UPLOAD:
            raise web.HTTPRequestEntityTooLarge(max_size=MAX_UPLOAD, actual_size=request.content_length,
                                                headers=HEADERS)
        active += 1
        try:
            async def receive():
                count = 0
                async for chunk in request.content.iter_chunked(65536):
                    count += len(chunk)
                    if count > MAX_UPLOAD:
                        raise web.HTTPRequestEntityTooLarge(max_size=MAX_UPLOAD, actual_size=count,
                                                           headers=HEADERS)
                return count
            count = await asyncio.wait_for(receive(), timeout=10)
            return web.json_response({'bytes': count}, headers=HEADERS)
        except asyncio.TimeoutError:
            raise web.HTTPRequestTimeout(headers=HEADERS)
        finally:
            active -= 1

    app.router.add_get('/api/network/ping', ping)
    app.router.add_get('/api/network/download', download)
    app.router.add_post('/api/network/upload', upload)
