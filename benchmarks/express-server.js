import express from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const userSchema = z.object({
	name: z.string(),
	email: z.string().email(),
});

const app = express();
app.use(express.json());

app.get('/hello', (req, res) => res.json({ ok: true }));
app.get('/users/:id', (req, res) => res.json({ id: req.params.id }));
app.post('/users', (req, res) => {
	try {
		const parsed = userSchema.parse(req.body);
		res.status(201).json({ id: randomUUID(), ...parsed });
	} catch {
		res.status(400).json({ error: 'invalid' });
	}
});

const port = Number(process.env.PORT ?? 9000);
app.listen(port);
