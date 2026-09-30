import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  encryptedSnapshots: defineTable({
    syncId: v.string(),
    payload: v.string(),
    updatedAt: v.number(),
    formatVersion: v.number(),
  }).index("by_sync_id", ["syncId"]),
});
