import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (value) {
          return validator.isEmail(value);
        },
        message: "Invalid email format",
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      validate: {
        validator: function (value) {
          return validator.isStrongPassword(value, {
            minLength: 8,
          });
        },
        message:
          "needs a bit more power — use 8+ characters with caps, small letters, a number, and a symbol 😅"
      },
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  try {
    if (!this.isModified("password")) {
      return;
    }

    this.password = await bcrypt.hash(this.password, 10);
  } catch (error) {
    console.error("Error : ", error.message);
  }
});

userSchema.methods.isValidPassword = async function (userPassword) {
  return bcrypt.compare(userPassword, this.password);
};

userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.createdAt;
  delete userObject.updatedAt;
  delete userObject.__v;
  return userObject;
};

userSchema.methods.getJWT = function () {
    const token = jwt.sign(
      { _id: this._id, role: this.role },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );
    return token;
};

export default mongoose.model("User", userSchema);
