"use client";

import { MapContainer, TileLayer, CircleMarker, Popup, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  lat: number;
  lon: number;
  label: string;
  color?: string;
}

export interface MapRoute {
  points: [number, number][];
  color: string;
}

interface Props {
  points: MapPoint[];
  routes?: MapRoute[];
  center?: [number, number];
  zoom?: number;
  heightClass?: string;
}

const DEFAULT_CENTER: [number, number] = [-1.6, -78.6]; // centro aproximado de Ecuador continental

export default function PdvMap({ points, routes = [], center, zoom = 6, heightClass = "h-[520px]" }: Props) {
  return (
    <div className={heightClass}>
      <MapContainer center={center ?? DEFAULT_CENTER} zoom={zoom} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {routes.map((r, idx) => (
          <Polyline key={idx} positions={r.points} pathOptions={{ color: r.color, weight: 3, opacity: 0.7 }} />
        ))}
        {points.map((p, idx) => (
          <CircleMarker
            key={idx}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{ color: p.color ?? "#E8792B", fillColor: p.color ?? "#E8792B", fillOpacity: 0.85 }}
          >
            <Popup>{p.label}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
