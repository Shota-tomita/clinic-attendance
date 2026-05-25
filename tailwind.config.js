/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
      },
      colors: {
        clinic: {
          50: '#f0f9f4',
          100: '#daf1e4',
          200: '#b8e3cb',
          300: '#88cda9',
          400: '#54b082',
          500: '#2f9162',
          600: '#1f7450',
          700: '#195d41',
          800: '#164a35',
          900: '#133d2c',
          950: '#09221a',
        }
      }
    },
  },
  plugins: [],
}
