"use client";

import { GoogleMap, MarkerF, PolylineF, useJsApiLoader, InfoWindowF } from "@react-google-maps/api";
import { useState } from "react";
import type { MapPoint, MapRoute } from "./PdvMap";

interface Props {
  points: MapPoint[];
  routes?: MapRoute[];
  center?: [number, number];
  zoom?: number;
  heightClass?: string;
}

const DEFAULT_CENTER: [number, number] = [-1.6, -78.6];

export default function GoogleMapView({ points, routes = [], center, zoom = 6, heightClass = "h-[520px]" }: Props) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
    id: "bogati-google-maps",
  });
  const [activo, setActivo] = useState<number | null>(null);

  const centerObj = { lat: (center ?? DEFAULT_CENTER)[0], lng: (center ?? DEFAULT_CENTER)[1] };

  if (!isLoaded) {
    return (
      <div className={`${heightClass} flex items-center justify-center bg-bogati-cream rounded-xl text-bogati-brown/60 text-sm`}>
        Cargando Google Maps…
      </div>
    );
  }

  return (
    <div className={heightClass}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%", borderRadius: "0.75rem" }}
        center={centerObj}
        zoom={zoom}
        options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}
      >
        {routes.map((r, idx) => (
          <PolylineF
            key={idx}
            path={r.points.map(([lat, lng]) => ({ lat, lng }))}
            options={{ strokeColor: r.color, strokeWeight: 3, strokeOpacity: 0.7 }}
          />
        ))}
        {points.map((p, idx) => (
          <MarkerF
            key={idx}
            position={{ lat: p.lat, lng: p.lon }}
            onClick={() => setActivo(idx)}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              fillColor: p.color ?? "#E8792B",
              fillOpacity: 0.9,
              strokeColor: "#ffffff",
              strokeWeight: 1,
              scale: 7,
            }}
          >
            {activo === idx && (
              <InfoWindowF onCloseClick={() => setActivo(null)}>
                <span className="text-xs">{p.label}</span>
              </InfoWindowF>
            )}
          </MarkerF>
        ))}
      </GoogleMap>
    </div>
  );
}
