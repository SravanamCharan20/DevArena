import mongoose from "mongoose";

const testcaseSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    output: { type: String, required: true },
    explanation: { type: String },
  },
  { _id: false }
);

const problemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },

    description: { type: String, required: true },
    inputFormat: { type: String },
    outputFormat: { type: String },
    constraints: { type: String },

    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      required: true,
    },

    tags: [{ type: String }],

    credit: { type: Number, default: 100 },

    timeLimit: { type: Number, default: 1000 }, // ms
    memoryLimit: { type: Number, default: 256 }, // MB

    exampleTestcases: {
      type: [testcaseSchema],
      default: [],
    },

    hiddenTestcases: {
      type: [testcaseSchema],
      default: [],
    },

    createdBy: {
      type: String,
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Problem", problemSchema);