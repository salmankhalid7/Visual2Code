import { apiFetch } from "./client";

export type User = {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
};

export type CreateUserInput = {
  email: string;
  name?: string | null;
};

export function listUsers(): Promise<User[]> {
  return apiFetch<User[]>("/users");
}

export function createUser(input: CreateUserInput): Promise<User> {
  return apiFetch<User>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
