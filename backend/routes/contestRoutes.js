import express from "express";
import { authorizeRoles, requireAuth } from "../middlewares/auth.js";
import {
  getActiveContest,
  getRecentFinishedContests,
} from "../controllers/contest/activeController.js";
import {
  createProblem,
  getProblemById,
  getProblemBySlug,
  listProblems,
} from "../controllers/contest/problemController.js";
import {
  getContestById,
  getRoomContest,
  getRoomLeaderboard,
  getRoomResults,
  getRoomSubmissions,
  mapContestToRoom,
} from "../controllers/contest/roomController.js";

const contestRouter = express.Router();

contestRouter.get("/active", requireAuth, getActiveContest);
contestRouter.get("/recent-finished", requireAuth, getRecentFinishedContests);

contestRouter.get("/problems", requireAuth, listProblems);
contestRouter.post("/problems", requireAuth, authorizeRoles("admin"), createProblem);
contestRouter.post(
  "/create-problem",
  requireAuth,
  authorizeRoles("admin"),
  createProblem
);
contestRouter.get("/problems/slug/:slug", requireAuth, getProblemBySlug);
contestRouter.get("/problems/:id", requireAuth, getProblemById);

contestRouter.get("/rooms/:roomCode/contest", requireAuth, getRoomContest);
contestRouter.get("/rooms/:roomCode/leaderboard", requireAuth, getRoomLeaderboard);
contestRouter.get("/rooms/:roomCode/submissions", requireAuth, getRoomSubmissions);
contestRouter.get("/rooms/:roomCode/results", requireAuth, getRoomResults);
contestRouter.post(
  "/rooms/:roomCode/contest",
  requireAuth,
  authorizeRoles("admin"),
  mapContestToRoom
);

contestRouter.get("/contests/:id", requireAuth, getContestById);

export default contestRouter;
