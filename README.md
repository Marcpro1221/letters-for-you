# A Little Place for You

A static, frontend-only personal website. It uses plain HTML, CSS, and JavaScript—no build step, dependencies, backend, account, analytics, or external assets.

## Personalize it

Edit `data.js` to change the recipient and sender names, letter, encouragements, flower messages, things you like, secret messages, and timeline memories. Leave `recipientName` empty to use the general greeting.

## Run and deploy

Open `index.html` directly for a quick preview, or serve this folder locally to test the installable/offline PWA behavior. Deploy the folder as a static site on Vercel; no build command or output directory is needed.

Spanish (Latin American) is the default language; use the **EN** button in the header to switch to English. Sound effects are enabled by default but never autoplay. Language and sound preferences, along with progress, are saved in this browser's `localStorage` only. Nothing is transmitted. If browser storage is blocked or unavailable, the experience continues in memory until the page is closed. The service worker caches the static site for later offline visits after its first successful load.

The timeline is configured in `data.js`. To reset local progress, use **Reset my garden** in the Memories section.
