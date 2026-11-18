import {
  DocumentKindSchema,
  RestaurantApplicationBody,
  RiderApplicationBody,
  SubmitRestaurantApplicationBody,
} from '@oregano/contracts';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import type { Config } from '../config';
import { AppError } from '../errors';
import { requireUser } from '../identity/auth';
import { storeDocument } from '../media/vault';
import {
  applicationSubject,
  editableApplicationId,
  getMyApplication,
  RESTAURANT_DOCUMENT_KINDS,
  saveMyApplication,
  submitMyApplication,
  touchApplication,
} from './restaurant-applications';
import {
  editableRiderId,
  getMyRiderApplication,
  RIDER_DOCUMENT_KINDS,
  riderSubject,
  saveMyRiderApplication,
  submitMyRiderApplication,
  touchRider,
} from './rider-applications';

const invalid = () => new AppError('validation_failed', 400, 'Some details are missing or wrong.');

/**
 * Applicant routes. None names an application id: a user only ever reaches their own, so there is nothing to
 * guess and no other applicant's data to reach.
 */
export function onboardingRoutes(app: FastifyInstance, config: Config, { db, store }: Services): void {
  const base = '/onboarding/restaurant-application';
  const keys = config.dataKeys;

  app.get(base, async (request) => {
    const user = requireUser(request);
    const view = await getMyApplication(db, user.id);
    if (!view) throw new AppError('not_found', 404, 'Not found.');
    return view;
  });

  app.put(base, async (request) => {
    const user = requireUser(request);
    const parsed = RestaurantApplicationBody.safeParse(request.body);
    if (!parsed.success) throw invalid();
    return saveMyApplication({ db, keys }, user.id, parsed.data);
  });

  app.post<{ Params: { kind: string } }>(`${base}/documents/:kind`, async (request, reply) => {
    const user = requireUser(request);
    const kind = DocumentKindSchema.safeParse(request.params.kind);
    if (!kind.success || !(RESTAURANT_DOCUMENT_KINDS as readonly string[]).includes(kind.data)) throw invalid();
    const applicationId = await editableApplicationId(db, user.id);
    const file = await request.file();
    if (!file) throw invalid();
    // toBuffer() throws FST_REQ_FILE_TOO_LARGE when the file passes the limit; the error handler answers 413.
    const bytes = await file.toBuffer();
    const stored = await storeDocument(
      { db, store, keys },
      applicationSubject(applicationId),
      kind.data,
      bytes,
      user.id,
    );
    await touchApplication(db, applicationId);
    reply.code(201);
    return { id: stored.id, kind: stored.kind, uploadedAt: stored.uploadedAt, outcome: stored.outcome };
  });

  app.post(`${base}/submit`, async (request) => {
    const user = requireUser(request);
    const parsed = SubmitRestaurantApplicationBody.safeParse(request.body);
    if (!parsed.success) throw invalid();
    return submitMyApplication(db, user.id, parsed.data.noTradeLicence);
  });

  const riderBase = '/onboarding/rider';

  app.get(riderBase, async (request) => {
    const user = requireUser(request);
    const view = await getMyRiderApplication(db, user.id);
    if (!view) throw new AppError('not_found', 404, 'Not found.');
    return view;
  });

  app.put(riderBase, async (request) => {
    const user = requireUser(request);
    const parsed = RiderApplicationBody.safeParse(request.body);
    if (!parsed.success) throw invalid();
    return saveMyRiderApplication(db, user.id, user.phone, parsed.data);
  });

  app.post<{ Params: { kind: string } }>(`${riderBase}/documents/:kind`, async (request, reply) => {
    const user = requireUser(request);
    const kind = DocumentKindSchema.safeParse(request.params.kind);
    if (!kind.success || !(RIDER_DOCUMENT_KINDS as readonly string[]).includes(kind.data)) throw invalid();
    const riderId = await editableRiderId(db, user.id);
    const file = await request.file();
    if (!file) throw invalid();
    const bytes = await file.toBuffer();
    const stored = await storeDocument({ db, store, keys }, riderSubject(riderId), kind.data, bytes, user.id);
    await touchRider(db, riderId);
    reply.code(201);
    return { id: stored.id, kind: stored.kind, uploadedAt: stored.uploadedAt, outcome: stored.outcome };
  });

  app.post(`${riderBase}/submit`, async (request) => {
    const user = requireUser(request);
    return submitMyRiderApplication(db, user.id);
  });
}
