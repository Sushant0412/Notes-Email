import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/user.js";
import wrapAsync from "../utils/wrapAsync.js";
import AppError from "../AppError.js";

const router = express.Router();

const createToken = (user) => {
  return jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

router.get("/login", (req, res) => {
  res.render("login");
});

router.get("/signup", (req, res) => {
  res.render("signup");
});

router.post(
  "/login",
  wrapAsync(async (req, res, next) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      throw new AppError("Invalid email or password", 401);
    }

    const token = createToken(user);
    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
    res.redirect("/tasks");
  })
);

router.post(
  "/signup",
  wrapAsync(async (req, res, next) => {
    const { email, password } = req.body;
    const user = await User.create({ email, password });

    const token = createToken(user);
    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
    res.redirect("/tasks");
  })
);

export default router;
