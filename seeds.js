import mongoose from "mongoose";
import Product from "./models/product.js";

mongoose
  .connect("mongodb+srv://sushant:hello@cluster0.usskidt.mongodb.net/")
  .then((res) => {
    console.log("Connected");
  })
  .catch((e) => {
    console.log("Error");
    console.log(e);
  });

const seedProducts = [
  {
    name: "Apple",
    price: 45,
    category: "fruit",
  },
  {
    name: "Orange",
    price: 30,
    category: "fruit",
  },
  {
    name: "Mango",
    price: 60,
    category: "fruit",
  },
  {
    name: "Tomato",
    price: 25,
    category: "vegetable",
  },
  {
    name: "Cabbage",
    price: 18,
    category: "vegetable",
  },
  {
    name: "Potato",
    price: 10,
    category: "vegetable",
  },
  {
    name: "Carrot",
    price: 22,
    category: "vegetable",
  },
  {
    name: "Strawberry",
    price: 40,
    category: "fruit",
  },
  {
    name: "Pineapple",
    price: 55,
    category: "fruit",
  },
  {
    name: "Lettuce",
    price: 15,
    category: "vegetable",
  },
  {
    name: "Milk",
    price: 5,
    category: "dairy",
  },
  {
    name: "Cheese",
    price: 20,
    category: "dairy",
  },
];

Product.deleteMany({})
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.log(e);
  });

Product.insertMany(seedProducts)
  .then((res) => {
    console.log(res);
  })
  .catch((e) => {
    console.log(e);
  });
