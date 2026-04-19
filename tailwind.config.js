export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-12deg)' },
          '50%':       { transform: 'rotate(12deg)'  },
        },
      },
      animation: {
        wiggle: 'wiggle 0.4s ease-in-out infinite',
      },
      borderRadius: {
        glass: "2rem",
        glassMd: "1.25rem",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
        glassSm: "0 2px 10px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
      },
      backdropBlur: {
        glass: "40px",
      },
    },
  },
  plugins: [],
 
}