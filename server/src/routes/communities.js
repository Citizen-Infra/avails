import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const response = await fetch('https://scenius-digest.vercel.app/api/groups');
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Communities fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch communities' });
  }
});

export default router;
