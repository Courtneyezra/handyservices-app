import { Router, Request, Response } from 'express';
import { searchAddresses } from './google-places';

const router = Router();

// GET /api/places/search?query=...
router.get('/search', async (req: Request, res: Response) => {
    try {
        const { query } = req.query;

        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        console.log(`[Places API] Searching for: ${query}`);

        // Use the existing helper which handles postcode validation + Google Places Text Search
        // Even though it says 'ByPostcode', it uses Google Places Text Search which works for addresses too if configured
        const results = await searchAddresses(query);

        res.json({ results });
    } catch (error) {
        console.error('[Places API] Search error:', error);
        res.status(500).json({ error: 'Failed to search places' });
    }
});

export default router;
