import mongoose from "mongoose";

const participantSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      enum: ["active", "disconnected", "left"],
      default: "active",
    },
    ready: {
      type: Boolean,
      default: false,
    },
    score: {
      type: Number,
      default: 0,
    },
    penalty: {
      type: Number,
      default: 0,
    },
    solvedCount: {
      type: Number,
      default: 0,
    },
    solvedProblemIds: {
      type: [String],
      default: [],
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const contestRoomSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    hostUserId: {
      type: String,
      required: true,
      trim: true,
    },
    hostName: {
      type: String,
      required: true,
      trim: true,
    },
    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
    },
    status: {
      type: String,
      enum: ["lobby", "running", "ended", "closed"],
      default: "lobby",
    },
    contestStartAt: {
      type: Date,
      default: null,
    },
    contestEndAt: {
      type: Date,
      default: null,
    },
    participants: {
      type: [participantSchema],
      default: [],
    },
  },
  { timestamps: true }
);

contestRoomSchema.index({ status: 1, updatedAt: -1 });
contestRoomSchema.index({ "participants.userId": 1, status: 1, updatedAt: -1 });

export default mongoose.model("ContestRoom", contestRoomSchema);
