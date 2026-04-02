import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const BACKEND_URL = process.env.BACKEND_URL || 'http://192.168.87.30:8071';

export default defineConfig({
	server: {
		host: '0.0.0.0',  // Listen on all network interfaces
		port: 5050,
		allowedHosts: true,
		hmr: false,
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
