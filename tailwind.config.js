// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:'#f0fbf4',100:'#daf4e4',200:'#b3e7c9',300:'#84d7ab',400:'#4ec486',
          500:'#22b66a',600:'#169255',700:'#126f43',800:'#0f5636',900:'#0d462e'
        }
      },
      boxShadow: { card: '0 6px 20px rgba(0,0,0,.06)' },
      borderRadius: { xl2: '1rem' }
    },
  },
  plugins: [],
};
