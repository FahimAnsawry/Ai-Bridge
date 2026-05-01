# Repository Guidelines

## Project Structure & Module Organization

This repository contains a local AI proxy server and React dashboard. Backend code lives in `apps/server/src`, organized by `config`, `middlewares`, `models`, `routes`, `services`, and `utils`. The frontend lives in `apps/client/src`, with pages under `pages`, reusable UI under `components`, shared API helpers under `api`, and static assets under `assets` and `public`. Operational notes live in `README.md`.

## Build, Test, and Development Commands

- `npm install`: install root server dependencies.
- `npm install --prefix apps/client`: install dashboard dependencies.
- `npm run dev`: run the Express server and Vite client together.
- `npm start`: start only the backend from `apps/server/src/index.js`.
- `npm run client`: start only the Vite frontend.
- `npm run build`: build the Vite dashboard.
- `node --check apps/server/src/index.js`: quick syntax check for the server entry point.

## Coding Style & Naming Conventions

Use JavaScript throughout. The server is CommonJS (`require`, `module.exports`); the client is ESM React (`import`, JSX). Match existing two-space indentation and semicolon usage in nearby files. Use PascalCase for React components and page files, camelCase for functions and variables, and descriptive kebab-case for Markdown files. Keep route handlers thin and place provider/auth/proxy behavior in `services`.

## Testing Guidelines

There is currently no configured automated test suite; `npm test` is a placeholder. For now, verify changes with targeted commands such as `npm run build`, `node --check apps/server/src/index.js`, and manual checks through the dashboard. When adding tests, colocate them near the code they exercise or use a clear `__tests__` folder, and name files after the unit or route being tested.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit-style prefixes, especially `fix:`. Continue with short imperative subjects such as `fix: persist session cookies` or `feat: add provider health panel`. Pull requests should include a brief summary, validation steps, linked issues when available, and screenshots for dashboard UI changes. Call out changes to `.env`, OAuth, session, database, or provider configuration explicitly.

## Security & Configuration Tips

Do not commit real secrets from `.env` or `.env.local`; use `.env.example` for documented placeholders. Treat API keys, session secrets, OAuth credentials, MongoDB URLs, and provider tokens as sensitive. Prefer configuration through environment variables or the dashboard settings flow.
