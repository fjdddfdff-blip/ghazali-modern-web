import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getSnapshot = query({
  args: { syncId: v.string() },
  handler: async (ctx, { syncId }) => {
    return await ctx.db
      .query("encryptedSnapshots")
      .withIndex("by_sync_id", (q) => q.eq("syncId", syncId))
      .unique();
  },
});

export const saveSnapshot = mutation({
  args: {
    syncId: v.string(),
    payload: v.string(),
    formatVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("encryptedSnapshots")
      .withIndex("by_sync_id", (q) => q.eq("syncId", args.syncId))
      .unique();
    const updatedAt = Date.now();
    const value = {
      payload: args.payload,
      formatVersion: args.formatVersion,
      updatedAt,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("encryptedSnapshots", { syncId: args.syncId, ...value });
    return updatedAt;
  },
});
