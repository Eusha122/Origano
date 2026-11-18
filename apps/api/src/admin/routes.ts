import type { AdminOrderRow } from '@oregano/contracts';
import type { OrderStatus } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app';
import { requireRole } from '../identity/auth';

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

export function adminRoutes(app: FastifyInstance, { db }: Services): void {
  app.get('/admin/orders', async (request): Promise<{ orders: AdminOrderRow[] }> => {
    requireRole(request, 'admin');
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
}
