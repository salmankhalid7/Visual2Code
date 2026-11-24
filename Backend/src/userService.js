import { prisma } from './prisma.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Throw an error with an HTTP status attached, so the global error
// handler in app.js can map it to a response without knowing our domain.
function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export async function listUsers() {
    return prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
}

export async function createUser({ email, name } = {}) {
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
        throw httpError(400, 'A valid email is required');
    }

    const data = {
        email: email.toLowerCase(),
        name: typeof name === 'string' && name.trim() ? name.trim() : null,
    };

    try {
        return await prisma.user.create({ data });
    } catch (err) {
        // P2002 = Prisma unique-constraint violation (duplicate email)
        if (err?.code === 'P2002') {
            throw httpError(409, 'A user with that email already exists');
        }
        throw err;
    }
}
