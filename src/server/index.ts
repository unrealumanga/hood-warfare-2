import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"
import { RoomManager } from "./rooms.ts"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
}

export interface ServerOptions {
  readonly port?: number
  readonly host?: string
  readonly staticDir?: string
  readonly simulatedLatencyMs?: number
  readonly snapshotEveryTicks?: number
  readonly seedBase?: number
}

export interface RunningServer {
  readonly port: number
  readonly url: string
  readonly wsUrl: string
  readonly rooms: RoomManager
  readonly close: () => Promise<void>
}

export async function createHoodWarfareServer(
  options: ServerOptions = {}
): Promise<RunningServer> {
  const host = options.host ?? process.env["HOST"] ?? "0.0.0.0"
  const port = options.port ?? Number(process.env["PORT"] ?? 8787)
  const staticDir =
    options.staticDir ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist")

  const rooms = new RoomManager({
    simulatedLatencyMs: options.simulatedLatencyMs,
    snapshotEveryTicks: options.snapshotEveryTicks,
    seedBase: options.seedBase
  })

  const httpServer = http.createServer((req, res) => {
    const reqPath = (req.url ?? "/").split("?")[0] ?? "/"
    if (reqPath === "/health") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*"
      })
      res.end(JSON.stringify({ ok: true, rooms: rooms.getRoomCount() }))
      return
    }

    if (fs.existsSync(staticDir)) {
      const safeRel = path.normalize(reqPath === "/" ? "/index.html" : reqPath).replace(/^(\.\.[/\\])+/, "")
      const candidate = path.join(staticDir, safeRel)
      const filePath = fs.existsSync(candidate) && fs.statSync(candidate).isFile()
        ? candidate
        : path.join(staticDir, "index.html")
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" })
        fs.createReadStream(filePath).pipe(res)
        return
      }
    }

    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
    res.end("Hood Warfare 2 authoritative WebSocket server is running.")
  })

  const wss = new WebSocketServer({ server: httpServer })
  wss.on("connection", (ws) => {
    rooms.attachSocket(ws)
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} on ${host} is already in use (EADDRINUSE). Stop the conflicting process or run with PORT=<free-port>.`
          )
        )
        return
      }
      reject(err)
    })
    httpServer.listen(port, host, () => resolve())
  })

  const addr = httpServer.address()
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host

  return {
    port: actualPort,
    url: `http://${displayHost}:${actualPort}`,
    wsUrl: `ws://${displayHost}:${actualPort}`,
    rooms,
    close: async () => {
      rooms.dispose()
      for (const client of wss.clients) {
        client.terminate()
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  }
}

// Auto-start when executed directly via `node dist-server/server/index.js` or `node --experimental-strip-types src/server/index.ts`
const isEntry =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isEntry) {
  createHoodWarfareServer()
    .then((srv) => {
      console.log(`[hood-warfare-2] authoritative server listening on ${srv.url} (ws: ${srv.wsUrl})`)
    })
    .catch((err) => {
      console.error("[hood-warfare-2] server failed to start:", err)
      process.exit(1)
    })
}
