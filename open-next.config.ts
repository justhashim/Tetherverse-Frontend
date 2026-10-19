import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";

/**
 * OpenNext configuration for the Cloudflare Workers deployment.
 *
 * The incremental cache is left at its default, which is a no-op, on purpose.
 * The game has no statically revalidated routes: every page is either a client
 * component that fetches its own data, or one of the four API routes in
 * src/app/api, which are all `no-store`. There is nothing for a cache to hold.
 *
 * The R2 override the Excel Play launcher uses would add a bucket binding that
 * has to be provisioned, named in three places and paid for, in exchange for
 * caching nothing.
 */
export default defineCloudflareConfig({});
