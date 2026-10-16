// Poster backgrounds of the "Scène IA" style. New ones are AI scenes stored per workspace; designs saved
// before the stock-photo picker was removed may still point to a CC0 StockSnap photo, which the image
// proxy keeps serving.

/** Legacy stock scene photos: only this CDN is accepted by the image proxy. */
export const STOCK_SCENE_URL = /^https:\/\/cdn\.stocksnap\.io\/img-thumbs\/(960w|280h)\/[A-Z0-9]+\.jpg$/;
/** Accepted in saved designs: an AI background stored for the workspace, or a legacy stock photo. */
export const SCENE_URL = /^(https:\/\/cdn\.stocksnap\.io\/img-thumbs\/(960w|280h)\/[A-Z0-9]+\.jpg|\/api\/marketing\/image\?asset=[0-9a-f-]{36})$/;
