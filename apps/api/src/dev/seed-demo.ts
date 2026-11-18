import { type Money, normalizeBdPhone, type TeamRole, taka } from '@oregano/domain';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { seedZones } from '../zones/seed';

export type DemoMenuKey = 'beefCheeseBurger' | 'chickenPizza' | 'crispyChickenBurger' | 'coldCoffee';

export type DemoIds = {
  zoneId: string;
  restaurantId: string;
  customerId: string;
  ownerId: string;
  riderId: string;
  secondRiderId: string;
  adminId: string;
  menuItemIds: Record<DemoMenuKey, string>;
};

const DEMO_ZONE_SLUG = 'chapainawabganj';

function phone(local: string): string {
  const normalised = normalizeBdPhone(local);
  if (!normalised) throw new Error(`Demo phone ${local} is not valid`);
  return normalised;
}

async function one<T extends Record<string, unknown>>(rows: Promise<T[]>): Promise<T> {
  const row = (await rows)[0];
  if (!row) throw new Error('Seed statement returned no row');
  return row;
}

async function upsertUser(db: Db, local: string, name: string | null, team?: TeamRole): Promise<string> {
  const row = await one(
    db.execute<{ id: string }>(sql`
      INSERT INTO users (phone, name) VALUES (${phone(local)}, ${name})
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`),
  );
  await db.execute(sql`DELETE FROM team_members WHERE user_id = ${row.id}`);
  if (team) {
    await db.execute(
      sql`INSERT INTO team_members (user_id, role, granted_by_label) VALUES (${row.id}, ${team}, 'demo seed')`,
    );
  }
  return row.id;
}

async function upsertRider(db: Db, userId: string, zoneId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO riders (user_id, zone_id, type, status, is_online)
    VALUES (${userId}, ${zoneId}, 'independent', 'approved', false)
    ON CONFLICT (user_id) DO UPDATE SET zone_id = EXCLUDED.zone_id, type = EXCLUDED.type,
      status = EXCLUDED.status, is_online = EXCLUDED.is_online`);
}

async function upsertCategory(
  db: Db,
  restaurantId: string,
  nameEn: string,
  nameBn: string,
  position: number,
): Promise<string> {
  const row = await one(
    db.execute<{ id: string }>(sql`
      INSERT INTO menu_categories (restaurant_id, name_en, name_bn, position)
      VALUES (${restaurantId}, ${nameEn}, ${nameBn}, ${position})
      ON CONFLICT (restaurant_id, name_en) DO UPDATE SET name_bn = EXCLUDED.name_bn, position = EXCLUDED.position
      RETURNING id`),
  );
  return row.id;
}

async function upsertItem(
  db: Db,
  restaurantId: string,
  categoryId: string,
  nameEn: string,
  nameBn: string,
  price: Money,
  position: number,
): Promise<string> {
  const row = await one(
    db.execute<{ id: string }>(sql`
      INSERT INTO menu_items (restaurant_id, category_id, name_en, name_bn, price_poisha, position)
      VALUES (${restaurantId}, ${categoryId}, ${nameEn}, ${nameBn}, ${price}, ${position})
      ON CONFLICT (restaurant_id, name_en) DO UPDATE SET category_id = EXCLUDED.category_id,
        name_bn = EXCLUDED.name_bn, price_poisha = EXCLUDED.price_poisha, position = EXCLUDED.position
      RETURNING id`),
  );
  return row.id;
}

/** Burger Lane, its menu, and the demo users. Safe to run repeatedly: upserts on natural keys. */
export async function seedDemo(db: Db): Promise<DemoIds> {
  await seedZones(db);
  const zone = await one(db.execute<{ id: string }>(sql`SELECT id FROM zones WHERE slug = ${DEMO_ZONE_SLUG}`));
  const zoneId = zone.id;

  const customerId = await upsertUser(db, '01711000001', null);
  const ownerId = await upsertUser(db, '01711000002', 'Burger Lane owner');
  const riderId = await upsertUser(db, '01711000003', 'Rahim');
  const adminId = await upsertUser(db, '01711000004', 'Oregano admin', 'superadmin');
  const secondRiderId = await upsertUser(db, '01711000005', 'Karim');
  await upsertUser(db, '01711000006', 'Oregano onboarding', 'onboarding');
  await upsertUser(db, '01711000007', 'Oregano support', 'support');
  await upsertRider(db, riderId, zoneId);
  await upsertRider(db, secondRiderId, zoneId);

  const restaurant = await one(
    db.execute<{ id: string }>(sql`
      INSERT INTO restaurants (zone_id, slug, name_en, name_bn, cuisine_en, cuisine_bn, address_line, location, is_open, prep_minutes)
      VALUES (${zoneId}, 'burger-lane', 'Burger Lane', 'বার্গার লেন', 'Burgers, pizza', 'বার্গার, পিৎজা',
        'Court Road, Chapainawabganj', ST_GeogFromText('SRID=4326;POINT(88.2710 24.5960)'), true, 20)
      ON CONFLICT (slug) DO UPDATE SET zone_id = EXCLUDED.zone_id, name_en = EXCLUDED.name_en,
        name_bn = EXCLUDED.name_bn, cuisine_en = EXCLUDED.cuisine_en, cuisine_bn = EXCLUDED.cuisine_bn,
        address_line = EXCLUDED.address_line, location = EXCLUDED.location, is_open = EXCLUDED.is_open,
        prep_minutes = EXCLUDED.prep_minutes
      RETURNING id`),
  );
  const restaurantId = restaurant.id;

  await db.execute(sql`
    INSERT INTO restaurant_staff (restaurant_id, user_id, role) VALUES (${restaurantId}, ${ownerId}, 'owner')
    ON CONFLICT (restaurant_id, user_id) DO UPDATE SET role = EXCLUDED.role`);

  const burgers = await upsertCategory(db, restaurantId, 'Burgers', 'বার্গার', 1);
  const pizza = await upsertCategory(db, restaurantId, 'Pizza', 'পিৎজা', 2);
  const drinks = await upsertCategory(db, restaurantId, 'Drinks', 'পানীয়', 3);

  const menuItemIds: DemoIds['menuItemIds'] = {
    beefCheeseBurger: await upsertItem(db, restaurantId, burgers, 'Beef Cheese Burger', 'বিফ চিজ বার্গার', taka(380), 1),
    crispyChickenBurger: await upsertItem(
      db,
      restaurantId,
      burgers,
      'Crispy Chicken Burger',
      'ক্রিস্পি চিকেন বার্গার',
      taka(220),
      2,
    ),
    chickenPizza: await upsertItem(
      db,
      restaurantId,
      pizza,
      'Chicken Pizza, 8 inch',
      'চিকেন পিৎজা, ৮ ইঞ্চি',
      taka(350),
      1,
    ),
    coldCoffee: await upsertItem(db, restaurantId, drinks, 'Cold Coffee', 'কোল্ড কফি', taka(180), 1),
  };

  return { zoneId, restaurantId, customerId, ownerId, riderId, secondRiderId, adminId, menuItemIds };
}
