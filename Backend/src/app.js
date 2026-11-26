import express from 'express';
import userRoutes from './userRoutes.js';
import generationRoutes from './jobs/generationRoutes.js';
import { logger } from './lib/logger.js';
import { redactSecrets } from './lib/redact.js';

const app = express();

// Parses JSON request bodies into req.body
app.use(express.json({ limit: '100kb' }));

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.use('/users', userRoutes);
app.use('/jobs', generationRoutes);

// Catch-all: any request not matched above returns a JSON 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    // Domain errors carry a `status`; everything else is a real 500.
    const status = err.status || 500;

    if (status >= 500) {
        logger.error('Request failed', { error: err, method: req.method, path: req.path });
    }

    const message = status >= 500
        ? 'Internal server error'
        : status === 400 && err.type === 'entity.parse.failed'
            ? 'Invalid JSON request body'
            : redactSecrets(err.message || 'Request failed');

    res.status(status).json({ error: message });
});

export default app;