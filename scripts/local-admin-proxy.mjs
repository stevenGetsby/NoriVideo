import http from 'node:http'
import net from 'node:net'

const listenHost = process.env.ADMIN_PROXY_HOST || '0.0.0.0'
const listenPort = Number(process.env.ADMIN_PUBLIC_PORT || 8080)
const upstreamHost = process.env.ADMIN_UPSTREAM_HOST || '127.0.0.1'
const upstreamPort = Number(process.env.ADMIN_UPSTREAM_PORT || 3000)

function adminHeaders(headers) {
  return {
    ...headers,
    host: `localhost:${listenPort}`,
    'x-forwarded-host': `localhost:${listenPort}`,
    'x-forwarded-port': String(listenPort),
    'x-forwarded-proto': 'http',
  }
}

const server = http.createServer((request, response) => {
  const proxyRequest = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: request.method,
    path: request.url,
    headers: adminHeaders(request.headers),
  }, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers)
    proxyResponse.pipe(response)
  })

  proxyRequest.on('error', (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    }
    response.end(`管理平台正在等待工作台服务启动：${error.message}`)
  })

  request.pipe(proxyRequest)
})

server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(upstreamPort, upstreamHost, () => {
    const headers = adminHeaders(request.headers)
    const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`]
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length > 0) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })

  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(listenPort, listenHost, () => {
  process.stdout.write(`管理平台端口已就绪：http://localhost:${listenPort}/zh/admin/signin\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
