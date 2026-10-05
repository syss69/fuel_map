import type { FuelCode, StationMarker } from './api';
export type DigestFavorite = Pick<StationMarker,'id'|'displayName'|'address'|'city'|'lat'|'lng'>;
export interface ManagedDigest {
  status:'PENDING'|'ACTIVE'|'UNSUBSCRIBED';
  fuelCode:FuelCode;
  lat:number;lng:number;radiusMeters:number;weekdays:number[];
  favoriteStationId:string|null;favoriteStation:DigestFavorite|null;
}
export const digestDays=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
