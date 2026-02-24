import express from "express";
import ContestRoom from "../models/ContestRoom.js";
import { requireAuth } from "../middlewares/auth.js";

const ACTIVE_ROOM_STATUSES = ["lobby", "running"];
const ACTIVE_PARTICIPANT_STATES = ["active", "disconnected"];

const contestRouter = express.Router();

contestRouter.get("/active", requireAuth, async (req, res) => {
  try {
    const userId = String(req.user._id);

    const activeRoom = await ContestRoom.findOne({
      status: { $in: ACTIVE_ROOM_STATUSES },
      participants: {
        $elemMatch: {
          userId,
          state: { $in: ACTIVE_PARTICIPANT_STATES },
        },
      },
    })
      .sort({ updatedAt: -1 })
      .select("roomCode status contestStartAt hostUserId hostName")
      .lean();

    if (!activeRoom) {
      return res.status(200).json({ activeRoom: null });
    }

    return res.status(200).json({
      activeRoom: {
        roomCode: activeRoom.roomCode,
        status: activeRoom.status,
        contestStartAt: activeRoom.contestStartAt
          ? new Date(activeRoom.contestStartAt).getTime()
          : null,
        hostUserId: activeRoom.hostUserId,
        hostName: activeRoom.hostName,
      },
    });
  } catch (error) {
    console.error("active contest error:", error.message);
    return res.status(500).json({
      message: "Could not load active contest",
    });
  }
});

export default contestRouter;
