CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_rider_idx" ON "orders" USING btree ("rider_id");