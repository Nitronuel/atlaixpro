/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        main: '#EEF8F2',
        sidebar: '#E8F5EE',
        card: '#F8FEFA',
        'card-hover': '#FFFFFF',
        primary: {
          green: '#3FA34D',
          'green-light': '#7DDC8A',
          'green-darker': '#2E7D3C',
          yellow: '#FFE66E',
          purple: '#B8A7E8',
          red: '#E85D75',
          blue: '#4B8A63'
        },
        text: {
          light: '#10131A',
          medium: '#606978',
          dark: '#98A1B1'
        },
        border: '#D7E8DC'
      },
      fontFamily: {
        sans: ['Roboto', 'Geist', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace']
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        }
      }
    }
  },
  plugins: []
};
