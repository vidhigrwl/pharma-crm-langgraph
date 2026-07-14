/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f0f4ff',
          100: '#d9e2ff',
          200: '#bcceff',
          300: '#93b0ff',
          400: '#6387ff',
          500: '#3b5cff',
          600: '#253cfa',
          700: '#1c2be6',
          800: '#1823bb',
          900: '#1b2494',
          950: '#11155a',
        },
      },
    },
  },
  plugins: [],
}
