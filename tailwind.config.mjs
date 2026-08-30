/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 二次元樱花/渐变主题色板
        sakura: {
          50: '#fff5f7',
          100: '#ffe4ec',
          200: '#ffcbd9',
          300: '#ffa3bd',
          400: '#ff6b94',
          500: '#f7406f',
          600: '#e01b55',
          700: '#bd1247',
          800: '#9c123f',
          900: '#84133c',
        },
        night: {
          DEFAULT: '#1a1423',
          50: '#f9f6fb',
          100: '#f0eaf4',
          200: '#dccce5',
          300: '#c0a5cf',
          400: '#9d76b5',
          500: '#7d5498',
          600: '#633e7c',
          700: '#4f3063',
          800: '#37203f',
          900: '#241628',
        },
        accent: {
          sun: '#ffb23e',
          mint: '#3ee6c0',
          ice: '#6ec9ff',
        },
      },
      fontFamily: {
        display: ['"Comic Code"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 8px 30px -6px rgba(247, 64, 111, 0.18), 0 4px 12px rgba(0,0,0,0.08)',
        glow: '0 0 24px rgba(247, 64, 111, 0.35)',
      },
      backgroundImage: {
        'sakura-gradient': 'linear-gradient(135deg, #ff6b94 0%, #f7406f 50%, #bd1247 100%)',
        'anime-dusk': 'linear-gradient(160deg, #241628 0%, #37203f 50%, #4f3063 100%)',
        'card-shine': 'linear-gradient(145deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 40%)',
      },
      borderRadius: {
        xl2: '1.4rem',
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2.5s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
    },
  },
  plugins: [],
};
