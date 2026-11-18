import { z } from 'zod';

export const LocationQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type LocationQuery = z.infer<typeof LocationQuery>;

export const ZoneSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameBn: z.string(),
});
export type ZoneSummary = z.infer<typeof ZoneSummary>;

export const RestaurantSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameBn: z.string(),
  cuisineEn: z.string(),
  cuisineBn: z.string(),
  /** True only when the owner's switch is on and the clock is inside the weekly hours. */
  isOpen: z.boolean(),
  /** The next opening time, "HH:MM" in zone time, when the switch is on but the hours say closed. */
  opensAt: z.string().nullable(),
  /** Prep time including busy mode. */
  prepMinutes: z.number().int(),
  deliveryFee: z.number().int().nullable(),
  coverImageUrl: z.string().nullable(),
});
export type RestaurantSummary = z.infer<typeof RestaurantSummary>;

export const RestaurantListResponse = z.object({
  zone: ZoneSummary.nullable(),
  restaurants: z.array(RestaurantSummary),
});
export type RestaurantListResponse = z.infer<typeof RestaurantListResponse>;

export const OptionChoice = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameBn: z.string(),
  priceDelta: z.number().int(),
  isAvailable: z.boolean(),
});
export type OptionChoice = z.infer<typeof OptionChoice>;

export const OptionGroup = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameBn: z.string(),
  required: z.boolean(),
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  options: z.array(OptionChoice),
});
export type OptionGroup = z.infer<typeof OptionGroup>;

export const MenuItem = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameBn: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionBn: z.string().nullable(),
  /** One unit now: the base price minus the best live discount. */
  price: z.number().int(),
  /** The price before the discount, only while a discount applies. */
  originalPrice: z.number().int().nullable(),
  discountLabel: z.object({ kind: z.enum(['percent', 'amount']), value: z.number().int() }).nullable(),
  imageUrl: z.string().nullable(),
  isAvailable: z.boolean(),
  optionGroups: z.array(OptionGroup),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const RestaurantDetail = RestaurantSummary.extend({
  addressLine: z.string(),
  hours: z.array(z.object({ day: z.number().int(), open: z.string(), close: z.string() })),
  popularItemIds: z.array(z.uuid()),
  categories: z.array(
    z.object({
      id: z.uuid(),
      nameEn: z.string(),
      nameBn: z.string(),
      items: z.array(MenuItem),
    }),
  ),
});
export type RestaurantDetail = z.infer<typeof RestaurantDetail>;

export const SearchResponse = z.object({
  restaurants: z.array(RestaurantSummary),
  dishes: z.array(
    z.object({
      item: z.object({
        id: z.uuid(),
        nameEn: z.string(),
        nameBn: z.string(),
        price: z.number().int(),
        originalPrice: z.number().int().nullable(),
        imageUrl: z.string().nullable(),
        isAvailable: z.boolean(),
      }),
      restaurant: RestaurantSummary,
    }),
  ),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const PopularTermsResponse = z.object({ terms: z.array(z.string()) });
export type PopularTermsResponse = z.infer<typeof PopularTermsResponse>;

/** One ring of [longitude, latitude] positions, the first repeated at the end. No holes. */
export const GeoPolygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(
      z
        .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
        .min(1)
        .max(600),
    )
    .length(1),
});
export type GeoPolygon = z.infer<typeof GeoPolygon>;

const zoneName = z.string().trim().min(1).max(60);
const feePerKm = z.number().int().min(0).max(20_000);
const minFee = z.number().int().min(0).max(50_000);
const roadFactor = z.number().min(1).max(3).multipleOf(0.01);

export const ZoneBody = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  nameEn: zoneName,
  nameBn: zoneName,
  boundary: GeoPolygon,
  /** Poisha per km, Tk 0 to Tk 200. */
  feePerKm,
  /** Poisha, Tk 0 to Tk 500. */
  minFee,
  roadFactor,
  timezone: z.string().max(40).optional(),
});
export type ZoneBody = z.infer<typeof ZoneBody>;

export const ZonePatch = z
  .object({
    nameEn: zoneName.optional(),
    nameBn: zoneName.optional(),
    boundary: GeoPolygon.optional(),
    feePerKm: feePerKm.optional(),
    minFee: minFee.optional(),
    roadFactor: roadFactor.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to change' });
export type ZonePatch = z.infer<typeof ZonePatch>;

export const AdminZone = z.object({
  id: z.uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameBn: z.string(),
  boundary: GeoPolygon,
  feePerKm: z.number().int(),
  minFee: z.number().int(),
  roadFactor: z.number(),
  timezone: z.string(),
  isActive: z.boolean(),
});
export type AdminZone = z.infer<typeof AdminZone>;
