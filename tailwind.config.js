export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-12deg)' },
          '50%':       { transform: 'rotate(12deg)'  },
        },
        'widget-settle': {
          '0%':   { transform: 'scale(1.04) translateY(-7px)' },
          '40%':  { transform: 'scale(0.97) translateY(4px)'  },
          '70%':  { transform: 'scale(1.02) translateY(-2px)' },
          '100%': { transform: 'scale(1)    translateY(0)'    },
        },
      },
      animation: {
        wiggle:          'wiggle 0.4s ease-in-out infinite',
        'widget-settle': 'widget-settle 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards',
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