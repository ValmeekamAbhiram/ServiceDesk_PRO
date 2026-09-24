import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dirname = path.dirname(fileURLToPath(import.meta.url));
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:5000';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // The shared contract lives outside this package root; both the dev
            // server and the production build resolve it through this alias.
            '@shared': path.resolve(dirname, '../shared/src'),
            '@': path.resolve(dirname, './src'),
        },
    },
    server: {
        port: 5173,
        strictPort: false,
        // Allow Vite to serve files from ../shared during development.
        fs: { allow: [path.resolve(dirname, '..')] },
        proxy: {
            '/api': { target: API_TARGET, changeOrigin: true },
            '/uploads': { target: API_TARGET, changeOrigin: true },
            // Socket.IO handshake + websocket upgrade.
            '/rt': { target: API_TARGET, ws: true, changeOrigin: true },
            '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom', 'react-router-dom'],
                    charts: ['recharts'],
                    query: ['@tanstack/react-query', 'axios'],
                },
            },
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.js'],
        include: ['src/**/*.{test,spec}.{js,jsx}'],
        css: false,
    },
});
