import express from "express";
import path from "path";
import mongoose from "mongoose";
import methodOverride from "method-override";
import bodyParser from "body-parser";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import Task from "./models/task.js";
import AppError from "./AppError.js";

dotenv.config();

const app = express();
console.clear();

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

app.get(
  "/tasks",
  wrapAsync(async (req, res, next) => {
    const allTasks = await Task.find({});
    res.render("home", { allTasks });
  })
);

app.get("/tasks/new", (req, res) => {
  res.render("new");
});

app.post(
  "/tasks/new",
  wrapAsync(async (req, res, next) => {
    const newTask = new Task(req.body);
    await newTask.save();
    const oneHourBeforeDeadline = new Date(newTask.deadline - 3600 * 1000);
    setTimeout(() => {
      sendReminderEmail(newTask.userEmail, newTask.title);
    }, oneHourBeforeDeadline - Date.now());
    res.redirect("/tasks");
  })
);

app.get(
  "/tasks/:id",
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
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    await Task.findByIdAndUpdate(id, req.body, { runValidators: true });
    res.redirect(`/tasks/${id}`);
  })
);

app.post(
  "/tasks",
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

app.delete("/tasks/:id", async (req, res, next) => {
  const { id } = req.params;
  await Task.findByIdAndDelete(id);
  res.redirect("/tasks");
});

const handleValidationError = (err) => {
  console.error(err);
  return new AppError(`Validation Error: ${err.message}`, 400);
};

app.use((err, req, res, next) => {
  if (err.name === "ValidationError") {
    err = handleValidationError(err);
  }
  next(err);
});

app.use((err, req, res, next) => {
  console.error(err);
  const { status = 500, message = "Internal Server Error" } = err;
  res.status(status).send(message);
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
