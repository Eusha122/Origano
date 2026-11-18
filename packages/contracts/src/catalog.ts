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
  isOpen: z.boolean(),
  prepMinutes: z.number().int(),
  deliveryFee: z.number().int().nullable(),
});
export type RestaurantSummary = z.infer<typeof RestaurantSummary>;

export const RestaurantListResponse = z.object({
  zone: ZoneSummary.nullable(),
  restaurants: z.array(RestaurantSummary),
});
export type RestaurantListResponse = z.infer<typeof RestaurantListResponse>;

export const MenuItem = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameBn: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionBn: z.string().nullable(),
  price: z.number().int(),
  isAvailable: z.boolean(),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const RestaurantDetail = RestaurantSummary.extend({
  addressLine: z.string(),
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
