import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api/graph': {
          target: 'https://api.thegraph.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/graph/, '')
        },
        '/api/solana-alchemy': {
          target: `https://mainnet.helius-rpc.com/?api-key=${env.VITE_HELIUS_API_KEY || ''}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/solana-alchemy/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        },
        '/api/solana-ankr': {
          target: 'https://rpc.ankr.com/solana',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/solana-ankr/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Origin': 'https://rpc.ankr.com'
          }
        },
        '/api/solana-public': {
          target: 'https://api.mainnet-beta.solana.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/solana-public/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Origin': 'https://explorer.solana.com'
          }
        }
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve('.', 'src'),
      }
    }
  };
});