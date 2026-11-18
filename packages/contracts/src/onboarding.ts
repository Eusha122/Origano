import { ACCOUNT_STATUSES, normalizeBdPhone, RIDER_TYPES, VEHICLE_TYPES } from '@oregano/domain';
import { z } from 'zod';

export const DOCUMENT_KINDS = [
  'nid_front',
  'nid_back',
  'photo',
  'trade_licence',
  'owner_nid_front',
  'owner_nid_back',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);

export const DocumentSummary = z.object({
  id: z.uuid(),
  kind: DocumentKindSchema,
  uploadedAt: z.iso.datetime(),
  outcome: z.enum(['accepted', 'rejected']).nullable(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const RestaurantApplicationBody = z.object({
  restaurantName: z.string().trim().min(2).max(80),
  cuisine: z.string().trim().min(2).max(60),
  addressLine: z.string().trim().min(5).max(200),
  restaurantPhone: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .refine((value) => value === null || normalizeBdPhone(value) !== null, {
      error: 'must be a Bangladesh phone number',
    }),
  ownerName: z.string().trim().min(2).max(80),
  payoutMethod: z.enum(['bkash', 'nagad', 'bank']),
  payoutAccount: z
    .string()
    .trim()
    .regex(/^[0-9 -]{6,34}$/),
});
export type RestaurantApplicationBody = z.infer<typeof RestaurantApplicationBody>;

export const RestaurantApplicationView = z.object({
  id: z.uuid(),
  status: z.enum(ACCOUNT_STATUSES),
  details: RestaurantApplicationBody.omit({ payoutAccount: true }).extend({ payoutAccountLast4: z.string() }),
  documents: z.array(DocumentSummary),
  missing: z.array(DocumentKindSchema),
  rejectionReason: z.string().nullable(),
  noTradeLicence: z.boolean(),
  restaurantId: z.uuid().nullable(),
});
export type RestaurantApplicationView = z.infer<typeof RestaurantApplicationView>;

export const SubmitRestaurantApplicationBody = z.object({ noTradeLicence: z.boolean() });
export type SubmitRestaurantApplicationBody = z.infer<typeof SubmitRestaurantApplicationBody>;

/** A zone a rider can apply in. (The catalog's ZoneSummary also carries slug and Bangla name.) */
export const RiderZone = z.object({ id: z.uuid(), name: z.string() });
export type RiderZone = z.infer<typeof RiderZone>;

const bdPhone = z
  .string()
  .trim()
  .max(30)
  .refine((value) => normalizeBdPhone(value) !== null, { error: 'must be a Bangladesh phone number' });

export const RiderApplicationBody = z.object({
  type: z.enum(RIDER_TYPES),
  zoneId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  agencyCode: z.string().trim().toUpperCase().length(8).optional(),
  vehicleType: z.enum(VEHICLE_TYPES),
  vehicleRegistration: z.string().trim().max(30).nullable(),
  guarantor: z.object({
    name: z.string().trim().min(2).max(80),
    phone: bdPhone,
    relation: z.string().trim().min(2).max(40),
  }),
});
export type RiderApplicationBody = z.infer<typeof RiderApplicationBody>;

export const RiderApplicationView = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  type: z.enum(RIDER_TYPES),
  zoneId: z.uuid(),
  agencyName: z.string().nullable(),
  restaurantName: z.string().nullable(),
  details: RiderApplicationBody.omit({ agencyCode: true }),
  documents: z.array(DocumentSummary),
  missing: z.array(DocumentKindSchema),
  rejectionReason: z.string().nullable(),
  suspendedReason: z.string().nullable(),
});
export type RiderApplicationView = z.infer<typeof RiderApplicationView>;

/** What the team sees in the review queue: names only, never phones or payout numbers. */
export const ApplicationQueueItem = z.object({
  kind: z.enum(['restaurant', 'rider']),
  /** The application id for a restaurant, the user id for a rider. */
  id: z.uuid(),
  name: z.string(),
  submittedAt: z.iso.datetime(),
  status: z.enum(ACCOUNT_STATUSES),
  riderType: z.enum(RIDER_TYPES).nullable(),
});
export type ApplicationQueueItem = z.infer<typeof ApplicationQueueItem>;

export const ApproveRestaurantBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  waiveLicence: z.boolean().default(false),
});
export type ApproveRestaurantBody = z.infer<typeof ApproveRestaurantBody>;

/** Why an application was turned down, in words the applicant will read. (The order flow has its own RejectBody.) */
export const RejectApplicationBody = z.object({ reason: z.string().trim().min(10).max(500) });
export type RejectApplicationBody = z.infer<typeof RejectApplicationBody>;

/** Door 1: the team applies for a restaurant owner who cannot do it themselves. */
export const AdminCreateRestaurantApplicationBody = RestaurantApplicationBody.extend({
  ownerPhone: z.string().trim().max(30),
});
export type AdminCreateRestaurantApplicationBody = z.infer<typeof AdminCreateRestaurantApplicationBody>;

export const RiderApplicationDetail = RiderApplicationView.extend({ userId: z.uuid() });
export type RiderApplicationDetail = z.infer<typeof RiderApplicationDetail>;

export const DocumentLink = z.object({ url: z.string(), ticket: z.string(), expiresAt: z.iso.datetime() });
export type DocumentLink = z.infer<typeof DocumentLink>;
