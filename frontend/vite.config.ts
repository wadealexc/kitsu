import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { debugBridge } from './vite-debug-bridge';

const BACKEND_URL = process.env.BACKEND_URL || 'http://192.168.87.30:8071';

export default defineConfig({
	server: {
		host: '0.0.0.0',  // Listen on all network interfaces
		port: 5050,
		allowedHosts: true,
		// Live reload for local development only (KITSU_HMR=1)
		hmr: process.env.KITSU_HMR === '1',
		proxy: {
			'/api': {
				target: BACKEND_URL,
				changeOrigin: true
			},
			'/health': {
				target: BACKEND_URL,
				changeOrigin: true
			}
		}
	},
	plugins: [
		sveltekit(),
		// Dev-only remote debugging of pages, e.g. the iOS home-screen app (see vite-debug-bridge.ts)
		...(process.env.VITE_DEBUG_BRIDGE === '1'
			? [debugBridge({ token: process.env.KITSU_DEBUG_TOKEN ?? '', dir: process.env.KITSU_DEBUG_DIR ?? '.debug' })]
			: []),
	],
	build: {
		sourcemap: true
	},
	worker: {
		format: 'es'
	},
	esbuild: {
		pure: process.env.ENV === 'dev' ? [] : ['console.log', 'console.debug', 'console.error']
	}
});
