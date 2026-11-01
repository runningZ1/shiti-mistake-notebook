import { drizzle } from "drizzle-orm/node-postgres";
import { createPool } from "./client";
import * as schema from "./schema";

export function getDb() {
  return drizzle(createPool(), { schema });
}
