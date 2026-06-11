export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Vehicle = {
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
  speed: number | null;
  ts: string;
};

export type VehiclesResponse = {
  vehicles: Vehicle[];
  updatedAt: string | null;
};

export type RecentArrival = {
  routeId: string;
  shortName: string;
  stopName: string;
  delaySec: number;
  eventEpoch: number;
};

export type ArrivalsResponse = {
  arrivals: RecentArrival[];
};
