/** @type {import('next').NextConfig} */
const nextConfig = {
  // react-leaflet no soporta bien el doble montaje de efectos de React Strict Mode en
  // desarrollo (lanza "Map container is already initialized" al recargar); se desactiva
  // por eso. No afecta el comportamiento en producción.
  reactStrictMode: false,
};

module.exports = nextConfig;
