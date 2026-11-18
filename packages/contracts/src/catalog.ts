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
