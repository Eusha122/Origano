import { type HoursBody, HoursBody as HoursSchema, PrepBody, type RestaurantControls } from '@oregano/contracts';
import type { OpeningInterval } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../admin/audit';
import type { Services } from '../app';
import type { Executor } from '../db/client';
import { AppError } from '../errors';
import { requireUser } from '../identity/auth';
import { requireCatalogActor } from './access';
import { getControls } from './controls-repo';
import { loadIntervals } from './hours-repo';
import { formatMinute } from './state';

const invalidHours = () => new AppError('invalid_hours', 400, 'Those opening hours do not work.');
const MAX_CLOSE = 1680; // 04:00 the next day

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Form rows to stored intervals: a close at or before the open runs into the next day, to at most 04:00. */
export function toIntervals(body: HoursBody): OpeningInterval[] {
  const intervals = body.intervals.map((i) => {
    const open = toMinutes(i.open);
    const close = toMinutes(i.close);
    return { day: i.day, openMinute: open, closeMinute: close <= open ? close + 1440 : close };
  });
  if (intervals.some((i) => i.closeMinute > MAX_CLOSE)) throw invalidHours();
  const byDay = new Map<number, OpeningInterval[]>();
  for (const i of intervals) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
  for (const [day, list] of byDay) {
    if (list.length > 3) throw invalidHours();
    const sorted = [...list].sort((a, b) => a.openMinute - b.openMinute);
    for (let n = 1; n < sorted.length; n++) {
      if ((sorted[n] as OpeningInterval).openMinute < (sorted[n - 1] as OpeningInterval).closeMinute)
        throw invalidHours();
    }
    // An interval that runs past midnight must end before the next day's first opening.
    const spill = Math.max(0, ...list.map((i) => i.closeMinute - 1440));
    const next = byDay.get((day + 1) % 7) ?? [];
    if (spill > 0 && next.some((i) => i.openMinute < spill)) throw invalidHours();
  }
  return intervals;
}

async function replaceHours(tx: Executor, restaurantId: string, intervals: OpeningInterval[]): Promise<void> {
  await tx.execute(sql`DELETE FROM restaurant_hours WHERE restaurant_id = ${restaurantId}`);
  for (const i of intervals) {
    await tx.execute(sql`
      INSERT INTO restaurant_hours (restaurant_id, day_of_week, open_minute, close_minute)
      VALUES (${restaurantId}, ${i.day}, ${i.openMinute}, ${i.closeMinute})`);
  }
}

const present = (intervals: OpeningInterval[]) => ({
  intervals: intervals.map((i) => ({
    day: i.day,
    open: formatMinute(i.openMinute),
    close: formatMinute(i.closeMinute),
  })),
});

export function hoursRoutes(app: FastifyInstance, { db, clock }: Services): void {
  app.get<{ Params: { id: string } }>('/restaurants/:id/hours', async (request) => {
    const user = requireUser(request);
    await requireCatalogActor(db, user, request.params.id, 'staff');
    return present((await loadIntervals(db, [request.params.id])).get(request.params.id) ?? []);
  });

  app.put<{ Params: { id: string } }>('/restaurants/:id/hours', async (request) => {
    const user = requireUser(request);
    await requireCatalogActor(db, user, request.params.id, 'owner');
    const parsed = HoursSchema.safeParse(request.body);
    if (!parsed.success) throw invalidHours();
    const intervals = toIntervals(parsed.data);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM restaurants WHERE id = ${request.params.id} FOR UPDATE`);
      await replaceHours(tx, request.params.id, intervals);
      await writeAudit(tx, {
        actor: { type: 'user', id: user.id },
        action: 'restaurant.hours_replaced',
        targetType: 'restaurant',
        targetId: request.params.id,
        data: { intervals: intervals.length },
        requestId: request.id,
      });
    });
    return present(intervals);
  });

  app.put<{ Params: { id: string } }>('/restaurants/:id/prep', async (request): Promise<RestaurantControls> => {
    const user = requireUser(request);
    await requireCatalogActor(db, user, request.params.id, 'owner');
    const parsed = PrepBody.safeParse(request.body);
    if (!parsed.success) throw new AppError('validation_failed', 400, 'Some details are missing or wrong.');
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE restaurants SET prep_minutes = ${parsed.data.prepMinutes} WHERE id = ${request.params.id}`,
      );
      await writeAudit(tx, {
        actor: { type: 'user', id: user.id },
        action: 'restaurant.prep_changed',
        targetType: 'restaurant',
        targetId: request.params.id,
        data: { prepMinutes: parsed.data.prepMinutes },
        requestId: request.id,
      });
    });
    return (await getControls(db, request.params.id, clock ? clock() : new Date())) as RestaurantControls;
  });
}
