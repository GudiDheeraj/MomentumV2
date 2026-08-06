/** Mirrors the `tailwind.config` object that index.html hands to the CDN
 *  runtime, so the prebuilt stylesheet is the same design system. */
module.exports = {
  content: ["./index.html", "./app.js"],
  theme: {
    extend: {
      colors: {
        navy:   { DEFAULT: '#171A1F', dark: '#0F1216', light: '#2A2E36' },
        mint:   { DEFAULT: '#3D5AFE', dark: '#2C42C7' },
        ember:  { DEFAULT: '#FF6A3D', soft: '#FFEEE6' },
        purple: { DEFAULT: '#7C5CFC', soft: '#F1EDFF' },
        green:  { DEFAULT: '#1FAE6B', soft: '#E5F7EE' },
        amber:  { DEFAULT: '#E4A335', soft: '#FBEBC9' },
        card: '#FFFFFF',
        pagebg: '#F7F8FA',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'Inter', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        'xs':   ['11px',   { lineHeight: '14.5px' }],
        'sm':   ['12.5px', { lineHeight: '18px' }],
        'base': ['14.5px', { lineHeight: '22.5px' }],
        'lg':   ['16px',   { lineHeight: '25px' }],
        'xl':   ['18px',   { lineHeight: '25px' }],
        '2xl':  ['21.5px', { lineHeight: '29px' }],
        '3xl':  ['27px',   { lineHeight: '32.5px' }],
        '4xl':  ['32.5px', { lineHeight: '36px' }],
        '5xl':  ['43px',   { lineHeight: '1' }],
        '6xl':  ['54px',   { lineHeight: '1' }],
      },
    },
  },
  plugins: [],
};
