import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bogati: {
          brown: "#4A2E1E",
          orange: "#E8792B",
          cream: "#FAF3EA",
        },
      },
    },
  },
  plugins: [],
};
export default config;
