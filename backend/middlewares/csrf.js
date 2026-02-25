import crypto from "crypto";

const isProduction = process.env.NODE_ENV === "production";

export const CSRF_COOKIE_NAME = "csrfToken";
export const CSRF_HEADER_NAME = "x-csrf-token";

export const buildCsrfCookieOptions = () => {
  const cookieOptions = {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };

  if (process.env.COOKIE_DOMAIN) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }

  return cookieOptions;
};

const safeTokenEqual = (a, b) => {
  const left = String(a || "");
  const right = String(b || "");
  if (!left || !right || left.length !== right.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
  } catch {
    return false;
  }
};

export const createCsrfToken = () => crypto.randomBytes(24).toString("hex");

export const rotateCsrfToken = (res) => {
  const token = createCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    ...buildCsrfCookieOptions(),
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
};

export const clearCsrfToken = (res) => {
  res.clearCookie(CSRF_COOKIE_NAME, buildCsrfCookieOptions());
};

export const ensureCsrfCookie = (req, res, next) => {
  const token = String(req.cookies?.[CSRF_COOKIE_NAME] || "");
  if (!token) {
    rotateCsrfToken(res);
  }
  next();
};

export const requireCsrf = (req, res, next) => {
  const method = String(req.method || "").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return next();
  }

  const cookieToken = String(req.cookies?.[CSRF_COOKIE_NAME] || "");
  const headerToken = String(req.headers?.[CSRF_HEADER_NAME] || "");

  if (!safeTokenEqual(cookieToken, headerToken)) {
    return res.status(403).json({
      success: false,
      code: "CSRF_INVALID",
      message: "Invalid CSRF token",
    });
  }

  return next();
};
