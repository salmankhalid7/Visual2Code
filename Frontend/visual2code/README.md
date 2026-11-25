This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Start the Express backend first (from `Backend/`), then the frontend:

```bash
# terminal 1 — Backend/
npm run dev   # http://localhost:3000

# terminal 2 — Frontend/visual2code/
npm run dev   # http://localhost:3001
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Backend connection

The backend runs on port 3000, so the frontend runs on port 3001 (`next dev -p 3001`).

`next.config.ts` rewrites every `/api/*` request to the Express server, which keeps
browser requests same-origin and means the backend needs no CORS configuration:

```
/api/users  ->  http://localhost:3000/users
```

Override the target with `BACKEND_URL` (see `.env.example`) when the backend is not
on `http://localhost:3000`.

Use the typed client in [`lib/api`](./lib/api) instead of calling `fetch` directly:

```ts
import { createUser, listUsers } from "@/lib/api";

const users = await listUsers();
const user = await createUser({ email: "ada@example.com", name: "Ada" });
```

In Client Components these calls go through the `/api` proxy. In Server Components,
Server Actions, and Route Handlers they call `BACKEND_URL` directly, because
relative URLs cannot be fetched on the server.

Failed responses throw `ApiError`, which carries the HTTP `status` and the backend's
`error` message (for example `409` for a duplicate email).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
