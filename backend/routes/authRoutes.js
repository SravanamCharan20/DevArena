import express from "express";
import User from "../models/User.js";
import { authorizeRoles, requireAuth } from "../middlewares/auth.js";
import {
  signinIdentityRateLimiter,
  signinIpRateLimiter,
  signupIdentityRateLimiter,
  signupIpRateLimiter,
} from "../middlewares/rateLimit.js";
import {
  clearCsrfToken,
  ensureCsrfCookie,
  requireCsrf,
  rotateCsrfToken,
} from "../middlewares/csrf.js";

const authRouter = express.Router();
const isProduction = process.env.NODE_ENV === "production";

const buildTokenCookieOptions = () => {
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };

  if (process.env.COOKIE_DOMAIN) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }

  return cookieOptions;
};

authRouter.post(
  "/signup",
  signupIpRateLimiter,
  signupIdentityRateLimiter,
  async (req, res) => {
    try {
      let { username, email, password } = req.body;

      if (!username || !email || !password) {
        return res.status(400).json({
          message: "Hey, you missed a few fields 😅",
        });
      }

      email = email.toLowerCase().trim();
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(409).json({
          message: "This email is already in use.",
        });
      }

      const newUser = await User.create({
        username,
        email,
        password,
      });

      const userResponse = {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      };

      return res.status(201).json({
        message: "Account created! You’re good to go 🚀",
        user: userResponse,
      });
    } catch (error) {
      console.error("Error : ", error.message);
      return res.status(500).json({
        message: error.message,
      });
    }
  }
);

authRouter.post(
  "/signin",
  signinIpRateLimiter,
  signinIdentityRateLimiter,
  async (req, res) => {
    try {
      let { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          message: "Please enter both email and password.",
        });
      }

      email = email.toLowerCase().trim();

      const existingUser = await User.findOne({ email });
      if (!existingUser) {
        return res.status(401).json({
          message: "That email or password doesn’t look right.",
        });
      }

      const validPassword = await existingUser.isValidPassword(password);

      if (!validPassword) {
        return res.status(401).json({
          message: "That email or password doesn’t look right.",
        });
      }

      const token = existingUser.getJWT();
      const userInfo = existingUser.toJSON();

      const cookieOptions = buildTokenCookieOptions();
      res.cookie("token", token, {
        ...cookieOptions,
        maxAge: 24 * 60 * 60 * 1000,
      });
      rotateCsrfToken(res);

      return res.status(200).json({
        message: "Welcome back! Logged in successfully 👋",
        user: userInfo,
      });
    } catch (error) {
      console.error("Error : ", error.message);
      return res.status(500).json({
        message: "We hit a snag. Please try again in a bit.",
      });
    }
  }
);

authRouter.post("/logout", requireCsrf, (req, res) => {
  res.clearCookie("token", buildTokenCookieOptions());
  clearCsrfToken(res);

  res.json({
    message: "You’ve been logged out. See you soon!",
  });
});

authRouter.get("/profile", requireAuth, ensureCsrfCookie, (req, res) => {
  res.json({
    message: "Here’s your profile.",
    user: req.user,
  });
});

authRouter.get(
  "/admin/dashboard",
  requireAuth,
  authorizeRoles("admin"),
  (req, res) => {
    res.json({
      message: "Welcome back, boss 👑",
    });
  }
);

export default authRouter;
