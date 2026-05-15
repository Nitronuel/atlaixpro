/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        main: '#111315',
        sidebar: '#16181A',
        card: '#1C1F22',
        'card-hover': '#222529',
        primary: {
          green: '#26D356',
          'green-light': '#2AF598',
          'green-darker': '#1FA847',
          yellow: '#F2C94C',
          purple: '#9B51E0',
          red: '#EB5757',
          blue: '#2F80ED'
        },
        text: {
          light: '#EAECEF',
          medium: '#8F96A3',
          dark: '#6C727A'
        },
        border: '#2A2E33'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif']
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
