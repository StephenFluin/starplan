import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * The site is static (Firebase Hosting, no server). The planner page is prerendered at build time;
 * everything browser-only (the WebGL map, saved plans, plans in the URL hash) starts after render.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
