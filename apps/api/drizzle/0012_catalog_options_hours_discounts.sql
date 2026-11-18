CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_bn" text NOT NULL,
	"min_select" integer NOT NULL,
	"max_select" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "option_groups_select_range" CHECK ("option_groups"."min_select" >= 0 AND "option_groups"."max_select" >= "option_groups"."min_select" AND "option_groups"."max_select" >= 1)
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_bn" text NOT NULL,
	"price_delta_poisha" integer NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "options_price_delta_non_negative" CHECK ("options"."price_delta_poisha" >= 0)
);
--> statement-breakpoint
CREATE TABLE "restaurant_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"scope" text NOT NULL,
	"menu_item_id" uuid,
	"category_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_discounts_kind_valid" CHECK ("restaurant_discounts"."kind" IN ('percent', 'amount')),
	CONSTRAINT "restaurant_discounts_value_valid" CHECK (("restaurant_discounts"."kind" = 'percent' AND "restaurant_discounts"."value" BETWEEN 1 AND 90) OR ("restaurant_discounts"."kind" = 'amount' AND "restaurant_discounts"."value" > 0)),
	CONSTRAINT "restaurant_discounts_scope_target" CHECK (("restaurant_discounts"."scope" = 'item' AND "restaurant_discounts"."menu_item_id" IS NOT NULL AND "restaurant_discounts"."category_id" IS NULL)
        OR ("restaurant_discounts"."scope" = 'category' AND "restaurant_discounts"."category_id" IS NOT NULL AND "restaurant_discounts"."menu_item_id" IS NULL)
        OR ("restaurant_discounts"."scope" = 'menu' AND "restaurant_discounts"."menu_item_id" IS NULL AND "restaurant_discounts"."category_id" IS NULL)),
	CONSTRAINT "restaurant_discounts_window" CHECK ("restaurant_discounts"."ends_at" > "restaurant_discounts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "restaurant_hours" (
	"restaurant_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_minute" integer NOT NULL,
	"close_minute" integer NOT NULL,
	CONSTRAINT "restaurant_hours_restaurant_id_day_of_week_open_minute_pk" PRIMARY KEY("restaurant_id","day_of_week","open_minute"),
	CONSTRAINT "restaurant_hours_day_range" CHECK ("restaurant_hours"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "restaurant_hours_open_range" CHECK ("restaurant_hours"."open_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "restaurant_hours_close_range" CHECK ("restaurant_hours"."close_minute" > "restaurant_hours"."open_minute" AND "restaurant_hours"."close_minute" <= 1680)
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "busy_extra_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "cover_image_key" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_poisha" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_group_id_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_discounts" ADD CONSTRAINT "restaurant_discounts_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_discounts" ADD CONSTRAINT "restaurant_discounts_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_discounts" ADD CONSTRAINT "restaurant_discounts_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_hours" ADD CONSTRAINT "restaurant_hours_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "option_groups_item_idx" ON "option_groups" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "options_group_idx" ON "options" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "restaurant_discounts_restaurant_idx" ON "restaurant_discounts" USING btree ("restaurant_id");--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_busy_valid" CHECK ("restaurants"."busy_extra_minutes" IN (0, 10, 20));
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "restaurants_name_trgm_idx" ON "restaurants" USING gin ("name_en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "restaurants_cuisine_trgm_idx" ON "restaurants" USING gin ("cuisine_en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "menu_items_name_trgm_idx" ON "menu_items" USING gin ("name_en" gin_trgm_ops);--> statement-breakpoint
INSERT INTO "restaurant_hours" ("restaurant_id", "day_of_week", "open_minute", "close_minute")
SELECT r."id", d, 660, 1320 FROM "restaurants" r CROSS JOIN generate_series(0, 6) AS d;
