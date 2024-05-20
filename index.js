import express from "express";
import path from "path";
import mongoose from "mongoose";
import session from "express-session";
import methodOverride from "method-override";
import bodyParser from "body-parser";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import Task from "./models/task.js";
import User from "./models/user.js";
import AppError from "./AppError.js";
import { protect } from "./middleware/auth.js";

dotenv.config();

const app = express();
console.clear();

app.use(express.static(path.join(process.cwd(), "public")));

// Initialize session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.log("Error connecting to MongoDB:", err);
  });

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(methodOverride("_method"));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASSWORD,
  },
});

async function sendReminderEmail(userEmail, taskTitle) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: userEmail,
      subject: `Reminder: Task "${taskTitle}" is due soon`,
      text: `This is a reminder that your task "${taskTitle}" is due in one hour. Please complete it on time.`,
    });
    console.log("Reminder email sent successfully");
  } catch (error) {
    console.error("Error sending reminder email:", error);
  }
}

function wrapAsync(fn) {
  return function (req, res, next) {
    fn(req, res, next).catch((err) => next(err));
  };
}

app.get("/", (req, res) => {
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.render("login");
});

// GET request handler for rendering the signup form
app.get("/signup", (req, res) => {
  res.render("signup");
});

// After the user logs in successfully
app.post(
  "/login",
  wrapAsync(async (req, res, next) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return next(new AppError("Invalid email or password", 401));
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });
    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
    req.session.userId = user.id;
    // Log the session information
    console.log("Session after login:", req.session);

    res.redirect("/tasks");
  })
);

// After the user signs up successfully
app.post(
  "/signup",
  wrapAsync(async (req, res, next) => {
    const { email, password } = req.body;
    const newUser = await User.create({ email, password });
    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });
    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });

    // Log the session information
    console.log("Session after signup:", req.session);

    res.redirect("/tasks");
  })
);

app.get(
  "/tasks",
  protect,
  wrapAsync(async (req, res, next) => {
    const userId = req.session.userId;
    const allTasks = await Task.find({ user: userId });
    res.render("home", { allTasks });
  })
);

app.get("/tasks/new", (req, res) => {
  // Get the user ID from the session
  const userId = req.session.userId;
  // Render the new task form with the userId included
  res.render("new", { userId: userId });
});

app.post("/tasks/new", async (req, res, next) => {
  try {
    const { title, description, deadline, userId } = req.body;

    if (!title || !deadline || !userId) {
      throw new AppError(
        "Title, deadline, and user information are required fields",
        400
      );
    }

    // Ensure deadline is a valid date
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) {
      throw new AppError("Invalid deadline date", 400);
    }

    // Ensure deadline is not in the past
    const currentTime = new Date();
    if (deadlineDate <= currentTime) {
      throw new AppError("Deadline cannot be in the past", 400);
    }

    // Ensure deadline is at least one hour ahead
    const oneHourAhead = new Date(currentTime.getTime() + 3600 * 1000);
    if (deadlineDate <= oneHourAhead) {
      throw new AppError("Deadline must be at least one hour ahead", 400);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const userEmail = user.email;

    const newTask = new Task({
      title: title,
      description: description,
      deadline: deadlineDate,
      user: userId,
      userEmail: userEmail,
    });
    await newTask.save();

    await sendReminderEmail(userEmail, newTask.title);

    res.redirect("/tasks");
  } catch (error) {
    next(error);
  }
});

// Handling GET request to /logout
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error logging out:", err);

      res.status(500).send("Error logging out");
    } else {
      res.redirect("/login");
    }
  });
});

app.get(
  "/tasks/:id",
  protect,
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    const task = await Task.findById(id);
    if (!task) {
      throw new AppError("Task not found", 404);
    } else {
      res.render("show", { task });
    }
  })
);

app.get(
  "/tasks/:id/edit",
  protect,
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    const task = await Task.findById(id);
    if (!task) {
      next(new AppError("Task not found", 404));
    } else {
      res.render("edit", { task });
    }
  })
);

app.put(
  "/tasks/:id/edit",
  protect,
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    await Task.findByIdAndUpdate(id, req.body, { runValidators: true });
    res.redirect(`/tasks/${id}`);
  })
);

app.post(
  "/tasks",
  protect,
  wrapAsync(async (req, res, next) => {
    const newTask = new Task(req.body);
    await newTask.save();
    const oneHourBeforeDeadline = new Date(newTask.deadline - 3600 * 1000);
    setTimeout(() => {
      sendReminderEmail(newTask.userEmail, newTask.title);
    }, oneHourBeforeDeadline - Date.now());
    res.redirect(`/tasks/${newTask._id}`);
  })
);

app.delete("/tasks/:id", protect, async (req, res, next) => {
  const { id } = req.params;
  await Task.findByIdAndDelete(id);
  res.redirect("/tasks");
});

const handleValidationError = (err, req, res, next) => {
  console.error(err);
  const status = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).render("error", { errorMessage: message });
};

app.use(handleValidationError);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).render("error", { errorMessage: message });
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
