/* global __APP_VERSION__, __BUILD_DATE__, __BUILD_ID__ */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.3.0-dev";
export const BUILD_DATE = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "dev";
export const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
export const VERSION_LABEL = `v${APP_VERSION} · ${BUILD_DATE} 构建`;
