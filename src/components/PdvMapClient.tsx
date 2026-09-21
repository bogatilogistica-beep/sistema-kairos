"use client";

import dynamic from "next/dynamic";

// Si hay una API key de Google Maps disponible en el navegador (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
// el mapa se dibuja con Google Maps; si no, se usa OpenStreetMap/Leaflet sin costo ni API key.
const usaGoogleMaps = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const PdvMap = dynamic(() => (usaGoogleMaps ? import("./GoogleMapView") : import("./PdvMap")), {
  ssr: false,
  loading: () => (
    <div className="h-[520px] flex items-center justify-center bg-bogati-cream rounded-xl text-bogati-brown/60 text-sm">
      Cargando mapa…
    </div>
  ),
});

export default PdvMap;
