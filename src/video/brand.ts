export const atlaix = {
  colors: {
    bg: '#111315',
    bgDeep: '#070809',
    panel: '#1C1F22',
    panelSoft: '#16181A',
    panelHover: '#222529',
    border: '#2A2E33',
    text: '#EAECEF',
    muted: '#8F96A3',
    darkText: '#6C727A',
    green: '#26D356',
    greenLight: '#2AF598',
    yellow: '#F2C94C',
    red: '#EB5757',
    blue: '#2F80ED',
    purple: '#9B51E0',
  },
  ease: {
    premium: [0.16, 1, 0.3, 1] as const,
    sharp: [0.7, 0, 0.2, 1] as const,
    soft: [0.22, 1, 0.36, 1] as const,
  },
};

export const demoEvents = [
  { token: '$VANTA', chain: 'SOL', event: 'Accumulation', score: 94, value: '$1.8M', age: '42s', tone: 'green' },
  { token: '$NOVA', chain: 'BASE', event: 'Liquidity Event', score: 88, value: '$740K', age: '2m', tone: 'yellow' },
  { token: '$ARC', chain: 'ETH', event: 'Unusual Activity', score: 81, value: '$320K', age: '5m', tone: 'blue' },
  { token: '$EMBER', chain: 'BNB', event: 'Market Stress', score: 76, value: '$590K', age: '7m', tone: 'red' },
];

export const alphaRows = [
  { token: '$VANTA', event: 'Accumulation', price: '$0.042', change: '+38.4%', mcap: '$8.2M', volume: '$2.4M', liquidity: '$618K', buys: '842', sells: '291', flow: '+$1.1M' },
  { token: '$NOVA', event: 'Liquidity Event', price: '$0.118', change: '+19.7%', mcap: '$21M', volume: '$5.6M', liquidity: '$1.4M', buys: '1,204', sells: '812', flow: '+$740K' },
  { token: '$ARC', event: 'Recovery', price: '$0.009', change: '+12.1%', mcap: '$4.7M', volume: '$980K', liquidity: '$422K', buys: '391', sells: '173', flow: '+$260K' },
  { token: '$EMBER', event: 'Market Stress', price: '$0.031', change: '-8.6%', mcap: '$13M', volume: '$1.9M', liquidity: '$610K', buys: '302', sells: '715', flow: '-$420K' },
];

export const smartWallets = [
  { name: 'Alpha Vault', wallet: '8ndK...9Qx2', score: 97, win: '82%', pnl: '+341%', balance: '$4.8M' },
  { name: 'Signal Fund', wallet: '0x91...A7e4', score: 92, win: '76%', pnl: '+218%', balance: '$2.1M' },
  { name: 'Early Buyer', wallet: '5PrQ...41Va', score: 89, win: '71%', pnl: '+144%', balance: '$920K' },
];
