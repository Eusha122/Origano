import { customType } from 'drizzle-orm/pg-core';

/** A PostGIS geography polygon in WGS 84. Written and read as WKT/EWKB by SQL, never by the ORM directly. */
export const geographyPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Polygon, 4326)';
  },
});
