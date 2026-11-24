import express from 'express';

const app = express();

// Parses JSON request bodies into req.body
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

// Catch-all: any request not matched above returns a JSON 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

export default app;