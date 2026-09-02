import express, { type Request, Response, NextFunction } from "express";
import { serveStatic } from "./static";
import { createServer } from "http";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error: any) {
  if (error?.code !== "ENOENT") throw error;
}

const app = express();
const httpServer = createServer(app);

app.disable("x-powered-by");
app.set("trust proxy", false);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https://i.ytimg.com https://yt3.ggpht.com https://*.googleusercontent.com; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
  }
  next();
});

app.use(express.json({ limit: "18mb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const requestPath = req.path;
  res.on("finish", () => {
    if (requestPath.startsWith("/api")) {
      // Never log response bodies. They may contain generated images, user
      // scripts, transcripts, research payloads, or private workspace content.
      log(`${req.method} ${requestPath} ${res.statusCode} in ${Date.now() - start}ms`);
    }
  });
  next();
});

function configuredPort(): number {
  const raw = (process.env.PORT || "5000").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`PORT must be a whole number from 1 to 65535; received ${JSON.stringify(raw)}.`);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be a whole number from 1 to 65535; received ${JSON.stringify(raw)}.`);
  }
  return port;
}

function configuredHost(): string {
  const host = (process.env.HOST || "127.0.0.1").trim();
  if (!host || host.length > 255 || /[\r\n\0]/.test(host)) throw new Error("HOST is invalid.");
  return host;
}

function installGracefulShutdown() {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received; closing the HTTP server.`, "server");
    const forced = setTimeout(() => {
      log("graceful shutdown timed out; closing remaining connections.", "server");
      httpServer.closeAllConnections?.();
      process.exit(1);
    }, 5_000);
    forced.unref();

    httpServer.close((error) => {
      clearTimeout(forced);
      if (error) {
        console.error("Failed to close the HTTP server cleanly:", error);
        process.exit(1);
      }
      log("HTTP server closed.", "server");
      process.exit(0);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function main() {
  const { registerRoutes } = await import("./routes");
  await registerRoutes(httpServer, app);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const candidate = Number.isInteger(err?.status) ? err.status : Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const status = candidate >= 400 && candidate <= 599 ? candidate : 500;
    log(`unhandled request error (${status})`, "express");
    if (!res.headersSent) res.status(status).json({ message: "Internal Server Error" });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = configuredPort();
  const host = configuredHost();
  httpServer.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      log(`could not start on ${host}:${port}; the address is already in use. Stop the existing YouTube Pro server or set PORT to a free port.`, "server");
      process.exit(1);
    }
    console.error("HTTP server error:", error);
    process.exit(1);
  });

  httpServer.listen({ port, host }, () => {
    installGracefulShutdown();
    log(`serving on http://${host}:${port}`, "server");
  });
}

void main().catch((error) => {
  console.error("YouTube Pro failed to start:", error);
  process.exitCode = 1;
});
