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
import cron from "node-cron";

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

app.use((req, res, next) => {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

mongoose
  .connect(process.env.MONGODB_URI)
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

async function scheduleReminderEmail(
  userEmail,
  taskTitle,
  taskDescription,
  taskDeadline
) {
  try {
    // Calculate the reminder time (one hour before the deadline)
    const reminderTime = new Date(taskDeadline.getTime() - 3600 * 1000);

    // Convert reminder time to cron pattern
    const cronPattern = `${reminderTime.getMinutes()} ${reminderTime.getHours()} * * *`;

    // Schedule the email using node-cron
    cron.schedule(cronPattern, async () => {
      try {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL,
            pass: process.env.PASSWORD,
          },
        });

        // Send the email
        await transporter.sendMail({
          from: process.env.EMAIL,
          to: userEmail,
          subject: `Reminder: Task "${taskTitle}" is due soon`,
          text: `This is a reminder that your task "${taskTitle}":\n ${taskDescription}.\n is due in one hour. \nDeadline: ${taskDeadline.toLocaleString()}\nPlease complete it on time.`,
        });

        console.log("Reminder email sent successfully");
      } catch (error) {
        console.error("Error sending reminder email:", error);
      }
    });
  } catch (error) {
    console.error("Error scheduling reminder email:", error);
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

app.get("/signup", (req, res) => {
  res.render("signup");
});

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
    console.log("Session after login:", req.session);
    res.redirect("/tasks");
  })
);

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

    const tasksToDelete = allTasks.filter((task) => task.deadline < Date.now());

    for (const task of tasksToDelete) {
      await Task.findByIdAndDelete(task._id);
      console.log(`Deleted task with crossed deadline: ${task.title}`);
    }

    const remainingTasks = await Task.find({ user: userId });

    res.render("home", { allTasks: remainingTasks });
  })
);

app.get("/tasks/new", protect, (req, res) => {
  const userId = req.session.userId;
  res.render("new", { userId: userId });
});

app.post("/tasks/new", protect, async (req, res, next) => {
  try {
    const { title, description, deadline, userId } = req.body;

    if (!title || !deadline || !userId) {
      throw new AppError(
        "Title, deadline, and user information are required fields",
        400
      );
    }

    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) {
      throw new AppError("Invalid deadline date", 400);
    }

    const currentTime = new Date();
    if (deadlineDate <= currentTime) {
      throw new AppError("Deadline cannot be in the past", 400);
    }

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

    // Schedule the reminder email
    scheduleReminderEmail(
      userEmail,
      newTask.title,
      newTask.description,
      deadlineDate
    );

    res.redirect("/tasks");
  } catch (error) {
    next(error);
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("jwt");
  req.session.destroy((err) => {
    if (err) {
      console.error("Error logging out:", err);
      res.status(500).send("Error logging out");
    } else {
      res.set("Cache-Control", "no-store");
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
      return next(new AppError("Task not found", 404));
    }

    // Convert deadline to local time
    const deadline = new Date(
      task.deadline.getTime() - task.deadline.getTimezoneOffset() * 60000
    );
    const deadlineDate = deadline.toISOString().split("T")[0]; // YYYY-MM-DD
    const deadlineTime = deadline.toISOString().split("T")[1].slice(0, 5); // HH:MM

    res.render("edit", { task, deadlineDate, deadlineTime });
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
