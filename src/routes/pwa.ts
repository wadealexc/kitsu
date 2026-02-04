/**
 * PWA API Router
 *
 * Provides Progressive Web App manifest for application installation.
 */

import { Router, type Response } from 'express';
import * as Types from './types.js';

const router = Router();

/* -------------------- PUBLIC ENDPOINTS -------------------- */

/**
 * GET /manifest.json
 *
 * Get the PWA manifest for application installation.
 * Returns manifest configuration for making the app installable on mobile and desktop.
 *
 * @returns PWAManifest - Standard PWA manifest JSON
 */
router.get('/', (
    req: Types.TypedRequest,
    res: Response<Types.PWAManifest | Types.ErrorResponse>
) => {
    res.json({
        name: 'Open WebUI',
        short_name: 'Open WebUI',
        description: 'Open WebUI is an open, extensible, user-friendly interface for AI that adapts to your workflow.',
        start_url: '/',
        display: 'standalone',
        background_color: '#343541',
        icons: [
            {
                src: '/static/logo.png',
                type: 'image/png',
                sizes: '500x500',
                purpose: 'any',
            },
            {
                src: '/static/logo.png',
                type: 'image/png',
                sizes: '500x500',
                purpose: 'maskable',
            },
        ],
        share_target: {
            action: '/',
            method: 'GET',
            params: {
                text: 'shared',
            },
        },
    });
});

export default router;
