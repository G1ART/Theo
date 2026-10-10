/**
 * Feed session-cache keys. This file stays free of `"use client"` so the
 * root layout can inline {@link FEED_RELOAD_BOOT_SCRIPT} on the server.
 * Importing the prefix from a client module makes it `undefined` there.
 */

export const SNAPSHOT_PREFIX = "feed:snapshot:v1:";

/** Set only when leaving the feed for an artwork or exhibition. */
export const RESTORE_ARMED_KEY = "feed:snapshot:restore:v1";

/**
 * Runs before paint when the loaded document is a reload of `/feed`.
 * Deletes scroll Y, pages, and cursor so the feed mount cannot read them.
 */
export const FEED_RELOAD_BOOT_SCRIPT = `try{var e=performance.getEntriesByType("navigation")[0];if(e&&e.type==="reload"){var p=location.pathname;if(p==="/feed"||p.indexOf("/feed/")===0){history.scrollRestoration="manual";scrollTo(0,0);sessionStorage.removeItem(${JSON.stringify(RESTORE_ARMED_KEY)});var keys=[];for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);if(k&&k.indexOf(${JSON.stringify(SNAPSHOT_PREFIX)})===0)keys.push(k);}for(var j=0;j<keys.length;j++)sessionStorage.removeItem(keys[j]);}}}catch(err){}`;
