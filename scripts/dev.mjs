import { spawn } from "node:child_process"
import net from "node:net"
import process from "node:process"

const SERVER_PORT = Number(process.env["PORT"] ?? 8787)
const VITE_PORT = Number(process.env["VITE_PORT"] ?? 5173)

function checkPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once("error", (err) => {
      resolve({ ok: false, code: err.code ?? "ERR" })
    })
    tester.once("listening", () => {
      tester.close(() => resolve({ ok: true }))
    })
    tester.listen(port, host)
  })
}

async function main() {
  const [srvCheck, viteCheck] = await Promise.all([
    checkPortAvailable(SERVER_PORT),
    checkPortAvailable(VITE_PORT)
  ])

  if (!srvCheck.ok) {
    console.error(
      `[dev:all] Port ${SERVER_PORT} is already in use (${srvCheck.code}). Stop the existing server or set PORT=<free-port> before running npm run dev:all.`
    )
    process.exit(1)
  }
  if (!viteCheck.ok) {
    console.error(
      `[dev:all] Port ${VITE_PORT} is already in use (${viteCheck.code}). Stop the existing Vite dev server or set VITE_PORT=<free-port> before running npm run dev:all.`
    )
    process.exit(1)
  }

  console.log(
    `[dev:all] Starting Hood Warfare 2 server (ws://localhost:${SERVER_PORT}) and Vite client (http://localhost:${VITE_PORT})...`
  )

  const serverProc = spawn(process.execPath, ["src/server/index.ts"], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(SERVER_PORT) }
  })

  const viteCmd = process.platform === "win32" ? "npx.cmd" : "npx"
  const viteProc = spawn(viteCmd, ["vite", "--port", String(VITE_PORT), "--strictPort"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, VITE_WS_URL: `ws://localhost:${SERVER_PORT}` }
  })

  let shuttingDown = false
  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    for (const child of [serverProc, viteProc]) {
      if (!child.killed) {
        try {
          child.kill("SIGTERM")
        } catch {
          // ignore
        }
      }
    }
    setTimeout(() => process.exit(exitCode), 250)
  }

  process.on("SIGINT", () => shutdown(0))
  process.on("SIGTERM", () => shutdown(0))

  serverProc.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev:all] Server exited with code ${code ?? 0}; stopping Vite.`)
      shutdown(code ?? 1)
    }
  })

  viteProc.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev:all] Vite exited with code ${code ?? 0}; stopping server.`)
      shutdown(code ?? 1)
    }
  })
}

main()
