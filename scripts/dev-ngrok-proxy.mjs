/**
 * Dev reverse proxy: one port → API (3004) + notification-ws (3001)
 * for a single ngrok tunnel. Zero dependencies.
 */
import http from "node:http";
import { URL } from "node:url";

const LISTEN = Number(process.env.PROXY_PORT || 3080);
const API = new URL(process.env.API_TARGET || "http://127.0.0.1:3004");
const WS = new URL(process.env.WS_TARGET || "http://127.0.0.1:3001");

function pickTarget(urlPath = "/") {
  if (
    urlPath.startsWith("/notifications") ||
    urlPath.startsWith("/socket.io") ||
    urlPath.startsWith("/api/v1/notifications")
  ) {
    return WS;
  }
  return API;
}

function proxyHttp(req, res) {
  const target = pickTarget(req.url || "/");
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    console.error("[proxy http]", err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad gateway");
  });
  req.pipe(upstream);
}

function proxyWs(req, socket, head) {
  const target = pickTarget(req.url || "/");
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    method: "GET",
    headers,
  });
  upstream.on("upgrade", (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(upRes.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (upHead?.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  upstream.on("error", (err) => {
    console.error("[proxy ws]", err.message);
    socket.destroy();
  });
  upstream.end();
  if (head?.length) upstream.write(head);
}

const server = http.createServer(proxyHttp);
server.on("upgrade", proxyWs);
server.listen(LISTEN, () => {
  console.log(
    `Dev proxy on http://localhost:${LISTEN} (API→${API.origin}, WS→${WS.origin})`,
  );
});
