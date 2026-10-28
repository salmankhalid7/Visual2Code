import AppError from "./AppError.js";

export default class NotFoundError extends AppError {
  constructor(resource = "Route") {
    super(`${resource} not found`, 404);
  }
}
