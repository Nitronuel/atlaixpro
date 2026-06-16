import path from 'path';
import { rmSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const heliusKey = env.HELIUS_API_KEY || '';
  const publicSupabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const publicSupabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
  return {
    // Production chunking for large intelligence and visualization modules.
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('vite/preload-helper')) {
              return 'app-core';
            }

            if (id.includes('node_modules')) {
              if (id.includes('lucide-react') || id.includes('d3-force')) {
                return 'graph-vendor';
              }
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
                return 'react-vendor';
              }
              if (id.includes('@supabase/supabase-js')) {
                return 'supabase-vendor';
              }
              if (id.includes('apexcharts')) {
                return 'charts-vendor';
              }
              return 'vendor';
            }

            if (id.includes('/src/contexts/')) {
              return 'app-core';
            }

            if (id.includes('/src/config/') || id.includes('/src/types/') || id.includes('/src/utils/')) {
              return 'shared-utils';
            }

            if (id.includes('/src/services/DatabaseService')) {
              return 'market-data';
            }

            if (id.includes('/src/pages/SafefyScan') || id.includes('/src/services/SafefyScanService') || id.includes('/src/services/forensics')) {
              return 'safe-scan';
            }

            if (id.includes('/src/pages/WalletTracking') || id.includes('/src/pages/SmartMoney') || id.includes('/src/pages/SmartWalletProfile') || id.includes('/src/pages/TokenSmartMoney')) {
              return 'wallet-intel';
            }

            return undefined;
          }
        }
      }
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Development proxies for provider APIs and local forensic services.
      proxy: {
        '/api/dexscreener': {
          target: 'https://api.dexscreener.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/dexscreener/, '')
        },
        '/api/graph': {
          target: 'https://api.thegraph.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/graph/, '')
        },
        '/api/solana-helius': {
          target: `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
          changeOrigin: true,
          rewrite: () => '',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        },
        '/api/solana-alchemy': {
          target: `https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY || ''}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/solana-alchemy/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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
        },
        '/api/forensics': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/providers': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/smart-money-scanner': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/smart-money': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/token-activity': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/token-sector': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/smart-alerts': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/detection': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/ai-assistant': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        },
        '/api/insightx': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: true
        }
      }
    },
    plugins: [
      react(),
      {
        name: 'atlaix-prune-video-only-assets',
        closeBundle() {
          rmSync(path.resolve('.', 'dist', 'atlaix-investor-bed.wav'), { force: true });
        }
      }
    ],
    define: {
      'process.env.VITE_SUPABASE_URL': JSON.stringify(publicSupabaseUrl),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(publicSupabaseAnonKey),
      'process.env.SUPABASE_URL': JSON.stringify(publicSupabaseUrl),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(publicSupabaseAnonKey),
      __ATLAIX_PUBLIC_SUPABASE_URL__: JSON.stringify(publicSupabaseUrl),
      __ATLAIX_PUBLIC_SUPABASE_ANON_KEY__: JSON.stringify(publicSupabaseAnonKey)
    },
    resolve: {
      alias: {
        '@': path.resolve('.', 'src'),
      }
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      globals: true
    }
  };
});
