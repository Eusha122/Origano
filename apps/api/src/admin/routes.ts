import {
  AdminCreateRestaurantApplicationBody,
  type AdminOrderRow,
  ApproveRestaurantBody,
  RejectApplicationBody,
} from '@oregano/contracts';
import { ACCOUNT_STATUSES, type AccountStatus, type OrderStatus } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import type { Config } from '../config';
import { AppError } from '../errors';
import { requirePermission } from '../identity/auth';
import { listTeam } from '../identity/team';
import {
  approveRestaurantApplication,
  approveRiderApplication,
  createApplicationForOwner,
  getRestaurantApplicationDetail,
  getRiderApplicationDetail,
  listApplicationQueue,
  rejectRestaurantApplication,
  rejectRiderApplication,
} from '../onboarding/review';

type Row = {
  id: string;
  number: number;
  status: OrderStatus;
  restaurant_name_en: string;
  customer_phone: string;
  rider_name: string | null;
  rider_phone: string | null;
  total_poisha: number;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function adminRoutes(app: FastifyInstance, config: Config, { db, clock }: Services): void {
  const now = (): Date => clock?.() ?? new Date();
  const uuid = (value: string): string => {
    if (!UUID.test(value)) throw new AppError('not_found', 404, 'Not found.');
    return value;
  };
  const invalid = () => new AppError('validation_failed', 400, 'Some details are missing or wrong.');

  app.get('/admin/team', async (request) => {
    requirePermission(request, 'team.read');
    return { members: await listTeam(db) };
  });

  app.get('/admin/orders', async (request): Promise<{ orders: AdminOrderRow[] }> => {
    requirePermission(request, 'orders.read');
    const rows = await db.execute<Row>(sql`
      SELECT o.id, o.number, o.status, r.name_en AS restaurant_name_en,
        c.phone AS customer_phone, rd.name AS rider_name, rd.phone AS rider_phone,
        o.total_poisha,
        to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
      FROM orders o
      JOIN restaurants r ON r.id = o.restaurant_id
      JOIN users c ON c.id = o.customer_id
      LEFT JOIN users rd ON rd.id = o.rider_id
      WHERE o.created_at > now() - interval '24 hours'
      ORDER BY o.created_at DESC, o.number DESC
      LIMIT 200`);
    return {
      orders: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        restaurantNameEn: row.restaurant_name_en,
        customerPhone: row.customer_phone,
        riderName: row.rider_name,
        riderPhone: row.rider_phone,
        total: row.total_poisha,
        createdAt: row.created_at,
      })),
    };
  });

  app.get<{ Querystring: { kind?: string; status?: string } }>('/admin/applications', async (request) => {
    requirePermission(request, 'applications.review');
    const { kind, status = 'under_review' } = request.query;
    if (kind !== undefined && kind !== 'restaurant' && kind !== 'rider') throw invalid();
    if (!(ACCOUNT_STATUSES as readonly string[]).includes(status)) throw invalid();
    return { items: await listApplicationQueue(db, { kind, status: status as AccountStatus }) };
  });

  app.get<{ Params: { id: string } }>('/admin/applications/restaurant/:id', async (request) => {
    requirePermission(request, 'applications.review');
    return getRestaurantApplicationDetail(db, uuid(request.params.id));
  });

  app.get<{ Params: { userId: string } }>('/admin/applications/rider/:userId', async (request) => {
    requirePermission(request, 'applications.review');
    return getRiderApplicationDetail(db, uuid(request.params.userId));
  });

  app.post<{ Params: { id: string } }>('/admin/applications/restaurant/:id/approve', async (request) => {
    const admin = requirePermission(request, 'applications.review');
    const body = ApproveRestaurantBody.safeParse(request.body);
    if (!body.success) throw invalid();
    return approveRestaurantApplication(db, admin.id, uuid(request.params.id), body.data, now());
  });

  app.post<{ Params: { id: string } }>('/admin/applications/restaurant/:id/reject', async (request) => {
    const admin = requirePermission(request, 'applications.review');
    const body = RejectApplicationBody.safeParse(request.body);
    if (!body.success) throw invalid();
    return rejectRestaurantApplication(db, admin.id, uuid(request.params.id), body.data.reason, now());
  });

  app.post<{ Params: { userId: string } }>('/admin/applications/rider/:userId/approve', async (request) => {
    const admin = requirePermission(request, 'applications.review');
    return approveRiderApplication(db, admin.id, uuid(request.params.userId), now());
  });

  app.post<{ Params: { userId: string } }>('/admin/applications/rider/:userId/reject', async (request) => {
    const admin = requirePermission(request, 'applications.review');
    const body = RejectApplicationBody.safeParse(request.body);
    if (!body.success) throw invalid();
    return rejectRiderApplication(db, admin.id, uuid(request.params.userId), body.data.reason, now());
  });

  app.post('/admin/restaurant-applications', async (request, reply) => {
    const admin = requirePermission(request, 'applications.review');
    const body = AdminCreateRestaurantApplicationBody.safeParse(request.body);
    if (!body.success) throw invalid();
    const view = await createApplicationForOwner({ db, keys: config.dataKeys }, admin.id, body.data);
    reply.code(201);
    return view;
  });
}
