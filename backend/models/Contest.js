import mongoose from "mongoose";

const contestSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },

    problems: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Problem",
      },
    ],

    duration: { type: Number, required: true }, // minutes

    createdBy: { type: String, required: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Contest", contestSchema);