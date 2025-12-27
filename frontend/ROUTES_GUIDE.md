# Routes Configuration Guide

This guide explains how to work with the unified routes configuration system implemented in Phase 3.

## Overview

All application routes are defined in a single configuration file: `src/config/routes.jsx`

This configuration is used to automatically generate:
- React Router routes in App.jsx
- Navigation menu in NavigationMenu.jsx

**Benefits:**
- Define routes once, use everywhere
- No code duplication
- Always in sync
- Easy to modify

---

## Quick Start

### Adding a New Route

```javascript
// src/config/routes.jsx

// 1. Import lazy if not already imported
import { lazy } from 'react';

// 2. Add lazy component import
const MyNewPage = lazy(() => import('../pages/MyNewPage'));

// 3. Add route to routes array
export const routes = [
  // ... existing routes

  {
    path: '/my-new-page',
    component: MyNewPage,
    label: 'My New Page',
    category: 'Category Name',
  },
];
```

That's it! The route and navigation menu item are automatically created.

### Removing a Route

```javascript
// Simply delete or comment out the route object in routes.jsx
// No need to modify App.jsx or NavigationMenu.jsx
```

### Changing a Route Path

```javascript
// Change the path in ONE place
{
  path: '/new-path',  // Changed from '/old-path'
  component: MyPage,
  label: 'My Page',
  category: 'Category',
}
```

---

## Route Configuration

### Basic Route

```javascript
{
  path: '/about',
  component: About,
  label: 'About',
  category: 'Information',
}
```

### Route with Subcategory

Creates a nested submenu:

```javascript
{
  path: '/quarterly-report',
  component: QuarterlyReport,
  label: 'Quarterly Report',
  category: 'Reports & Graphs',  // Top-level dropdown
  subcategory: 'Reports',        // Nested submenu
}
```

This creates:
```
Reports & Graphs
  └── Reports
      └── Quarterly Report
```

### Route with Context Wrapper

Automatically wraps the component in a provider:

```javascript
{
  path: '/forecast-page',
  component: ForecastPage,
  label: 'Forecast Page',
  category: 'Forecasting',
  wrapper: ForecastProvider,  // Auto-wrapped
}
```

Equivalent to:
```javascript
<ForecastProvider>
  <ForecastPage />
</ForecastProvider>
```

### Route Not in Navigation

```javascript
{
  path: '/hidden-page',
  component: HiddenPage,
  label: 'Hidden Page',
  showInNav: false,  // Not shown in menu
}
```

### Eagerly Loaded Route

By default, all routes except Home are lazy-loaded. To eagerly load:

```javascript
// Import directly (not lazy)
import CriticalPage from '../pages/CriticalPage';

{
  path: '/critical',
  component: CriticalPage,  // Not lazy
  label: 'Critical Page',
  category: 'Important',
}
```

---

## Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | - | URL path (must start with /) |
| `component` | Component | Yes | - | React component to render |
| `label` | string | Yes | - | Display name in navigation |
| `category` | string | No | null | Top-level menu category |
| `subcategory` | string | No | null | Nested submenu category |
| `wrapper` | Component | No | null | Context provider to wrap route |
| `showInNav` | boolean | No | true | Show in navigation menu |

---

## Examples

### Example 1: Simple Page

```javascript
const ContactUs = lazy(() => import('../pages/ContactUs'));

{
  path: '/contact',
  component: ContactUs,
  label: 'Contact Us',
  category: 'Information',
}
```

Creates route `/contact` and adds "Contact Us" to "Information" menu.

### Example 2: Nested Report

```javascript
const SalesReport = lazy(() => import('../pages/SalesReport'));

{
  path: '/sales-report',
  component: SalesReport,
  label: 'Sales Report',
  category: 'Reports & Graphs',
  subcategory: 'Reports',
}
```

Creates nested menu:
```
Reports & Graphs
  └── Reports
      └── Sales Report
```

### Example 3: Route with Provider

```javascript
const TeamPage = lazy(() => import('../pages/TeamPage'));

{
  path: '/team',
  component: TeamPage,
  label: 'Team',
  category: 'Organization',
  wrapper: TeamProvider,
}
```

Automatically wraps TeamPage in TeamProvider.

### Example 4: Multiple Routes in Same Category

```javascript
const UploadFile = lazy(() => import('../pages/UploadFile'));
const DownloadFile = lazy(() => import('../pages/DownloadFile'));

export const routes = [
  {
    path: '/upload',
    component: UploadFile,
    label: 'Upload',
    category: 'Files',
  },
  {
    path: '/download',
    component: DownloadFile,
    label: 'Download',
    category: 'Files',
  },
];
```

Creates:
```
Files
  ├── Upload
  └── Download
```

---

## Navigation Menu Structure

The menu is auto-generated from routes configuration:

### Root Level Items

Routes with `category: null` appear at root level:

```javascript
{
  path: '/',
  component: Home,
  label: 'Home',
  category: null,  // Root level
}
```

### Category Dropdowns

Routes with same `category` are grouped:

```javascript
// Both routes grouped under "Database" dropdown
{
  path: '/upload',
  category: 'Database',
  // ...
},
{
  path: '/refresh',
  category: 'Database',
  // ...
}
```

### Nested Submenus

Routes with `subcategory` create nested dropdowns:

```javascript
{
  path: '/balance',
  category: 'Reports & Graphs',
  subcategory: 'Reports',
  // ...
},
{
  path: '/chart',
  category: 'Reports & Graphs',
  subcategory: 'Graphs',
  // ...
}
```

Creates:
```
Reports & Graphs
  ├── Reports
  │   └── Balance
  └── Graphs
      └── Chart
```

---

## Helper Functions

### getRouterRoutes()

Returns array of routes for the router (filters out routes without components):

```javascript
import { getRouterRoutes } from '@/config/routes';

const routes = getRouterRoutes();
// Returns only routes with non-null component
```

### generateMenuItems()

Returns hierarchical menu structure for navigation:

```javascript
import { generateMenuItems } from '@/config/routes';

const menuItems = generateMenuItems();
// Returns array of menu categories with submenus
```

---

## Best Practices

### 1. Use Lazy Loading

Always use lazy loading except for critical routes:

```javascript
// ✅ Good - Lazy loaded
const MyPage = lazy(() => import('../pages/MyPage'));

// ❌ Avoid - Eagerly loaded (increases bundle size)
import MyPage from '../pages/MyPage';
```

### 2. Consistent Category Names

Use consistent category names across routes:

```javascript
// ✅ Good - Consistent naming
category: 'Reports & Graphs',
category: 'Reports & Graphs',

// ❌ Avoid - Inconsistent naming
category: 'Reports & Graphs',
category: 'Reports and Graphs',  // Creates separate menus
```

### 3. Meaningful Labels

Use clear, descriptive labels:

```javascript
// ✅ Good
label: 'Forecast Scenarios',

// ❌ Avoid
label: 'FC Scenarios',  // Unclear abbreviation
```

### 4. Logical Categorization

Group related routes in same category:

```javascript
// ✅ Good - Related routes grouped
{
  path: '/forecast-scenarios',
  category: 'Forecasting',
},
{
  path: '/forecast-modules',
  category: 'Forecasting',
}

// ❌ Avoid - Related routes in different categories
{
  path: '/forecast-scenarios',
  category: 'Forecasting',
},
{
  path: '/forecast-modules',
  category: 'Configuration',
}
```

### 5. Use Wrappers for Shared Context

If multiple routes need same context, use wrapper:

```javascript
{
  path: '/forecast-scenarios',
  wrapper: ForecastProvider,
  // ...
},
{
  path: '/forecast-modules',
  wrapper: ForecastProvider,
  // ...
}
```

---

## Troubleshooting

### Route Not Appearing

**Problem:** Added route but it doesn't appear in menu or router.

**Check:**
1. Is `component` defined and imported?
2. Is route in `routes` array?
3. Is `showInNav` set to false?

### Menu Structure Wrong

**Problem:** Menu doesn't show expected hierarchy.

**Check:**
1. Verify `category` spelling is consistent
2. Check `subcategory` is spelled correctly
3. Ensure category/subcategory match existing structure

### Page Not Loading

**Problem:** Route exists but page shows blank or loading forever.

**Check:**
1. Is component import path correct?
2. Does component file exist?
3. Check browser console for import errors

### Wrapper Not Working

**Problem:** Context not available in component.

**Check:**
1. Is `wrapper` imported in routes.jsx?
2. Is component using the context hook?
3. Verify wrapper is a valid React component

---

## Migration from Manual Routes

If you're updating old code that manually defined routes:

### Before (Manual)

```javascript
// App.jsx
<Route path="/my-page" element={<MyPage />} />

// NavigationMenu.jsx
{
  label: "Category",
  submenu: [
    { label: "My Page", path: "/my-page" }
  ]
}
```

### After (Unified Config)

```javascript
// routes.jsx
const MyPage = lazy(() => import('../pages/MyPage'));

{
  path: '/my-page',
  component: MyPage,
  label: 'My Page',
  category: 'Category',
}

// App.jsx - Auto-generated (no changes needed)
// NavigationMenu.jsx - Auto-generated (no changes needed)
```

---

## Summary

- ✅ **One place:** All routes in `src/config/routes.jsx`
- ✅ **Auto-sync:** Router and menu always match
- ✅ **Lazy loading:** Automatic code splitting
- ✅ **Easy to modify:** Add/remove/change routes easily
- ✅ **Type-safe:** All metadata in one structure

See [PHASE3_COMPLETE.md](PHASE3_COMPLETE.md) for implementation details.
