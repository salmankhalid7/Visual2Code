import express from 'express';
import userRoutes from './userRoutes.js';

const app = express();

// Parses JSON request bodies into req.body
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.use('/users', userRoutes);

// Catch-all: any request not matched above returns a JSON 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    // Domain errors carry a `status`; everything else is a real 500.
    const status = err.status || 500;

    if (status >= 500) {
        console.error(err);
    }

    res.status(status).json({ error: err.message || 'Internal server error' });
});

export default app;