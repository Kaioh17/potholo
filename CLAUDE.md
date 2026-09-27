# Potholo

Potholo detects potholes in Chicago from phone gyroscope and accelerometer readings, processes them on a FastAPI backend, and shows the results in a web app.
See `README.md` for the product overview and run instructions.

## Scope of the prototype

- Web app in `web/`: React with Vite. Currently a landing page and a login form.
- Data processing in FastAPI: real, not mocked. It will live in its own top-level directory.
- Mobile app: React Native later. Do not build it in this prototype.

## What is mocked

Mock only what the React Native app would have provided through Android's `SensorEventListener`.
That means generated sensor readings (gyroscope and accelerometer samples with timestamps, plus location and speed).
Do not mock the backend.
The FastAPI service must genuinely ingest, process and analyse the readings.
Keep the mock data generator separate from the API, and keep the API's input format the same as what a real phone would send.
Swapping mock data for real phone data must not require API changes.

## Conventions

- The app name renders as lowercase "potholo" in the UI, using the Bricolage Grotesque font.
  All other text uses DM Sans.
- Follow the minimalist UI style already in `web/src/styles/`.
  Use the tokens in `tokens.css`: warm monochrome, amber as the only accent, flat surfaces, 1px borders, no gradients or heavy shadows.
- Icons come from `@phosphor-icons/react` (bold weight).
  Do not use Lucide, Feather or emojis.
- Copy is plain and specific.
  Avoid marketing filler such as "seamless" or "next-gen".
- Do not claim capabilities the prototype does not have yet.

## Commands

Run these from `web/`:

- `npm run dev` starts the dev server.
- `npm run build` builds for production.
- `npm run lint` runs oxlint and must stay warning-free.

## Git and secrets

- `.env` holds secrets and is gitignored.
  Never read, print or commit it.
- Work happens on feature branches.
  Do not commit unless asked.
