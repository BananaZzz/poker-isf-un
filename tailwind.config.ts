import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        felt: {
          900: '#0a1a12',
          800: '#0f2a1c',
          700: '#123924',
          600: '#175030',
        },
        ink: {
          950: '#0a0d10',
          900: '#101418',
          800: '#161b21',
          700: '#1e242c',
          600: '#2a323d',
          500: '#3a4552',
        },
        brass: {
          400: '#e6c67a',
          500: '#d4af51',
          600: '#b8952e',
          700: '#8f721e',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Inter', 'sans-serif'],
        display: ['ui-serif', 'Georgia', 'serif'],
      },
      boxShadow: {
        table: 'inset 0 0 120px rgba(0,0,0,.6), 0 30px 80px rgba(0,0,0,.5)',
        card: '0 2px 6px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)',
      },
    },
  },
  plugins: [],
};

export default config;
