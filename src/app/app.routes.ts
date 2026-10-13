import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Starplan · Stardew Valley farm planner',
    loadComponent: () => import('./features/planner/planner-page').then((m) => m.PlannerPage),
  },
  { path: '**', redirectTo: '' },
];
