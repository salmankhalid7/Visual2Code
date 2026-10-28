import express from "express";
import cors from "cors";
import helmet from "helmet";

import { corsOptions } from "./config/cors.js";
import notFound from "./middlewares/notFound.js";
import errorHandler from "./middlewares/errorHandler.js";
import routes from "./routes/index.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Visual2Code API is running",
  });
});

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

export default app;
