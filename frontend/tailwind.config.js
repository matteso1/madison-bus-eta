/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                metro: {
                    primary: '#C5050C', // Madison Metro Red
                    secondary: '#282828',
                    accent: '#FFD700',
                }
            }
        },
    },
    plugins: [],
}
