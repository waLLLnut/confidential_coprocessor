/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0B0B10',
        card: '#11131A',
        border: '#1C1F2A',
        purple: '#6F4FF2',
        'purple-dark': '#5A3FD6',
      },
    },
  },
  plugins: [],
}