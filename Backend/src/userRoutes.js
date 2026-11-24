import { Router } from 'express';
import { listUsers, createUser } from './userService.js';

const router = Router();

// GET /users
router.get('/', async (req, res, next) => {
    try {
        const users = await listUsers();
        res.json(users);
    } catch (err) {
        next(err);
    }
});

// POST /users
router.post('/', async (req, res, next) => {
    try {
        const user = await createUser(req.body);
        res.status(201).json(user);
    } catch (err) {
        next(err);
    }
});

export default router;
