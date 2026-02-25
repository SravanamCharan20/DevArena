import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema(
  {
    submissionType: {
      type: String,
      enum: ["run", "submit"],
      default: "run",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "judging", "done", "failed"],
      default: "done",
      required: true,
      index: true,
    },
    requestId: {
      type: String,
      index: true,
    },
    userId: { type: String, required: true },
    username: { type: String, required: true },

    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Problem",
      required: true,
    },

    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
    },

    roomCode: { type: String, required: true },

    code: { type: String, required: true },
    language: { type: String, required: true },
    customInput: { type: String, default: "" },
    stdout: { type: String, default: "" },
    stderr: { type: String, default: "" },

    verdict: {
      type: String,
      enum: [
        "Pending",
        "Accepted",
        "Wrong Answer",
        "Time Limit Exceeded",
        "Runtime Error",
        "Compilation Error",
        "Memory Limit Exceeded",
      ],
      default: "Pending",
    },

    testcasesPassed: { type: Number, default: 0 },
    testcasesTotal: { type: Number, default: 0 },
    scoreDelta: { type: Number, default: 0 },
    penaltyDelta: { type: Number, default: 0 },
    executionTime: { type: Number },
    memoryUsed: { type: Number },
    judgedAt: { type: Date },
  },
  { timestamps: true }
);

submissionSchema.index({
  roomCode: 1,
  userId: 1,
  problemId: 1,
  submissionType: 1,
  createdAt: -1,
});

export default mongoose.model("Submission", submissionSchema);
