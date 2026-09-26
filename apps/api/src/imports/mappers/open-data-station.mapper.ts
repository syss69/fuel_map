import { Injectable } from '@nestjs/common';
import { FuelAvailability, FuelCode, NormalizedFuel, NormalizedStation } from '@fuel-map/database';
import { z } from 'zod';
import { ExternalStation } from '../providers/fuel-data.provider';

const nullableNumber = z.number().finite().nullable().optional();
const nullableString = z.string().nullable().optional();
const externalSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  cp: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
  adresse: nullableString,
  ville: nullableString,
  code_departement: z.union([z.string(), z.number()]).transform(String),
  geom: z.object({ lon: z.number().finite(), lat: z.number().finite() }),
  carburants_disponibles: z.array(z.string()).nullable().optional(),
  carburants_indisponibles: z.array(z.string()).nullable().optional(),
}).catchall(z.unknown());

const fuelFields: ReadonlyArray<{
  code: FuelCode;
  externalName: string;
  prefix: string;
}> = [
  { code: 'GAZOLE', externalName: 'Gazole', prefix: 'gazole' },
  { code: 'SP95', externalName: 'SP95', prefix: 'sp95' },
  { code: 'SP98', externalName: 'SP98', prefix: 'sp98' },
  { code: 'E10', externalName: 'E10', prefix: 'e10' },
  { code: 'E85', externalName: 'E85', prefix: 'e85' },
  { code: 'GPLC', externalName: 'GPLc', prefix: 'gplc' },
];

@Injectable()
export class OpenDataStationMapper {
  map(raw: ExternalStation): NormalizedStation {
    const base = externalSchema.parse(raw);
    const available = new Set(base.carburants_disponibles ?? []);
    const unavailable = new Set(base.carburants_indisponibles ?? []);
    const fuels = fuelFields.map(({ code, externalName, prefix }): NormalizedFuel => {
      const price = nullableNumber.parse(raw[`${prefix}_prix`]);
      const ruptureType = nullableString.parse(raw[`${prefix}_rupture_type`]);
      return {
        code,
        priceMilliEur: price == null ? null : Math.round(price * 1_000),
        availability: this.availability(ruptureType, externalName, available, unavailable),
        sourcePriceUpdatedAt: this.date(raw[`${prefix}_maj`]),
        sourceRuptureStartedAt: this.date(raw[`${prefix}_rupture_debut`]),
      };
    });
    return {
      officialId: base.id,
      address: base.adresse ?? null,
      city: base.ville ?? null,
      postalCode: base.cp ?? null,
      departmentCode: base.code_departement,
      latitude: base.geom.lat,
      longitude: base.geom.lon,
      fuels,
    };
  }

  private availability(
    ruptureType: string | null | undefined,
    name: string,
    available: Set<string>,
    unavailable: Set<string>,
  ): FuelAvailability {
    const rupture = ruptureType?.toLowerCase();
    if (rupture === 'definitive') return 'PERMANENTLY_UNAVAILABLE';
    if (rupture === 'temporaire') return 'TEMPORARILY_UNAVAILABLE';
    if (available.has(name)) return 'AVAILABLE';
    if (unavailable.has(name)) return 'UNAVAILABLE';
    return 'UNKNOWN';
  }

  private date(value: unknown): Date | null {
    if (value == null || value === '') return null;
    const parsed = z.string().datetime({ offset: true }).safeParse(value);
    if (!parsed.success) return null;
    const date = new Date(parsed.data);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
