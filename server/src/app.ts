/**
 * Express app - mirrors divinipartner/api-server/src/app.ts: one Node process
 * serving the built Vite SPA AND the /api router. Native session verification
 * (cookie / Bearer) runs as middleware (authMiddleware) before the router.
 */
import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authMiddleware } from "./auth.js";
import router, { errorHandler } from "./routes.js";
import { getAllowedOrigins, IS_PROD } from "./config.js";
import { authRateLimit } from "./lib/rateLimit.js";

const app: Express = express();
app.set("trust proxy", 1);

// Security headers via Helmet. Applied first so every response gets hardened
// headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS
// (in prod), and a Content-Security-Policy that restricts inline scripts/styles.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // allow CSS-in-JS / inline styles from React
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    // HSTS: only in production (requires HTTPS).
    hsts: IS_PROD
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    crossOriginEmbedderPolicy: false, // allow third-party resources without COEP headers
  }),
);

// CORS - allow PUBLIC_APP_URL / ALLOWED_ORIGINS and same-origin (no Origin).
const allowedOrigins = getAllowedOrigins();
if (IS_PROD && allowedOrigins.length === 0) {
  // Fail closed in production: an empty allowlist must NOT allow all origins.
  console.warn(
    "[cors] PRODUCTION with an empty CORS allowlist. Cross-origin requests are DENIED. " +
      "Set PUBLIC_APP_URL / ALLOWED_ORIGINS to your real domain(s).",
  );
}
app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl
      // Empty allowlist: permissive only in dev; deny cross-origin in production.
      if (allowedOrigins.length === 0) return cb(null, !IS_PROD);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  }),
);

// JSON bodies (file bytes travel via multipart, not JSON).
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Native session verification - stashes verified claims on req.
app.use(authMiddleware());

// Tight per-IP rate limit on the auth surface (login/register/forgot/resend/
// verify) to blunt credential-stuffing and email-bomb abuse. Mounted before the
// router so it covers every /api/auth/* route.
app.use("/api/auth", authRateLimit);

// API
app.use("/api", router);
app.use("/api", errorHandler);

// ---- serve the built SPA from this same process ---------------------------
// The build step copies Vite's dist/ into server/dist/public.
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = process.env.CLIENT_DIST_DIR
  ? path.resolve(process.env.CLIENT_DIST_DIR)
  : path.join(serverDir, "public");

app.use(express.static(clientDistDir, { index: false }));

// SPA history fallback: any non-API GET returns index.html.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(clientDistDir, "index.html"), (err) => {
    if (err) next();
  });
});

export default app;
