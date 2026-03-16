export type StationType = 'pc_principal' | 'pc_harpon' | 'relais' | 'observation';

export interface TacticalPoint {
  id: string;
  name: string;
  type: StationType;
  lat: number;
  lng: number;
  antennaHeight: number;
}

export interface RelaySuggestion {
  lat: number;
  lng: number;
  elevation: number;
  distance: number;
  reason: string;
}

export interface ViewshedResult {
  fromId: string;
  toId: string;
  visible: boolean;
  elevationProfile: { distance: number; elevation: number; lat: number; lng: number }[];
  losLine: { distance: number; elevation: number }[];
  suggestions: RelaySuggestion[];
}

export const STATION_LABELS: Record<StationType, string> = {
  pc_principal: 'PC Principal',
  pc_harpon: 'PC Harpon',
  relais: 'Relais',
  observation: 'Observation',
};

export const STATION_COLORS: Record<StationType, string> = {
  pc_principal: '#2563eb',
  pc_harpon: '#7c3aed',
  relais: '#f59e0b',
  observation: '#22c55e',
};
