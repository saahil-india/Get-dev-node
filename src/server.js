import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import vendorRoutes from './routes/vendors.js';
import technologyRoutes from './routes/technologies.js';
import candidateRoutes from './routes/candidates.js';
import salesRoutes from './routes/sales.js';
import userRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/technologies', technologyRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);

// central error handler — keeps stack traces out of API responses
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GD Portal API listening on :${PORT}`));
