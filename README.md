# SBL

SBL league management site with separate commissioner and user-facing functionality.

## Structure

- `index.html` - sign-in / user landing page
- `admin.html` - commissioner dashboard and league administration
- `draft.html` - user-facing draft room
- `season.html` - season view
- `rosters.html` - rosters
- `stats.html` - statistics
- `team-analysis.html` - team analysis
- `free-agency.html` - free agency
- `css/` - site styles
- `js/` - shared client code and services
- `docs/refactor/` - project/refactor documentation
- `docs/archive/` - retained legacy code that is not part of the runtime

## Supabase

The browser client is configured in `js/sbl-supabase.js`. The site uses the Supabase publishable browser key; server/service-role credentials must never be committed.

## Deployment

This repository is structured so the application can be served directly from the repository root, including static hosting such as GitHub Pages.
