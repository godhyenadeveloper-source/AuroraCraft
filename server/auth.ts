import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { Strategy as LocalStrategy } from "passport-local";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User {}
  }
}

const scryptAsync = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algo, saltB64, hashB64] = parts;
  if (algo !== "scrypt") return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret";
  return session({
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
      sameSite: "lax",
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "identifier", passwordField: "password" },
      async (identifier, password, done) => {
        try {
          const normalized = `${identifier ?? ""}`.trim().toLowerCase();
          if (!normalized) return done(null, false);

          const user =
            normalized.includes("@")
              ? await storage.getUserByEmail(normalized)
              : await storage.getUserByUsername(normalized);

          if (!user?.passwordHash) return done(null, false);
          const ok = await verifyPassword(password, user.passwordHash);
          if (!ok) return done(null, false);
          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );

  passport.serializeUser((user: any, cb) => cb(null, user.id));
  passport.deserializeUser(async (id: string, cb) => {
    try {
      const user = await storage.getUser(id);
      if (!user) return cb(null, false);
      return cb(null, user as any);
    } catch (err) {
      return cb(err as Error);
    }
  });

  app.post("/api/auth/register", async (req: any, res, next) => {
    try {
      const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
      const username = req.body?.username ? String(req.body.username).trim().toLowerCase() : null;
      const password = req.body?.password ? String(req.body.password) : null;

      if (!username || username.length < 3) {
        return res.status(400).json({ message: "Username must be at least 3 characters" });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      if (email && !email.includes("@")) {
        return res.status(400).json({ message: "Invalid email" });
      }

      const existingByUsername = await storage.getUserByUsername(username);
      if (existingByUsername) {
        return res.status(409).json({ message: "Username already in use" });
      }
      if (email) {
        const existingByEmail = await storage.getUserByEmail(email);
        if (existingByEmail) {
          return res.status(409).json({ message: "Email already in use" });
        }
      }

      const passwordHash = await hashPassword(password);
      const user = await storage.upsertUser({
        email,
        username,
        passwordHash,
        firstName: req.body?.firstName ? String(req.body.firstName).trim() : null,
        lastName: req.body?.lastName ? String(req.body.lastName).trim() : null,
      });

      req.login(user, (err: any) => {
        if (err) return next(err);
        const { passwordHash: _ph, ...safeUser } = user as any;
        return res.json(safeUser);
      });
    } catch (err) {
      return next(err);
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });

      req.login(user, (loginErr: any) => {
        if (loginErr) return next(loginErr);
        const { passwordHash: _ph, ...safeUser } = user;
        return res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req: any, res) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return next();
};

export const isAdmin: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = req.user as any;
  if (!user?.isAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }

  return next();
};
