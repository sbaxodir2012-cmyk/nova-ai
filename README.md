# Nova AI — free AI assistant (Cloudflare Pages + Gemini free tier)

## Structure
```
nova-ai/
├─ public/            # static site (landing, chat app, SEO files)
│  ├─ index.html      # SEO landing page + JSON-LD
│  ├─ app.html        # chat UI (history, search, rename, delete, themes, markdown, code highlight, streaming)
│  ├─ privacy.html  robots.txt  sitemap.xml  favicon.svg
└─ functions/api/chat.js   # secure backend: validation, rate limit, Gemini/Groq, streaming
```
No build step and no npm install: it is plain HTML/JS, so nothing can fail to compile.

## 1. Get a free AI key (no card needed)
- Gemini: https://aistudio.google.com/apikey → "Create API key".
- Optional backup: Groq https://console.groq.com/keys (free tier).

## 2. Deploy free on Cloudflare Pages
1. Create a free GitHub account, create a repo, upload this folder's contents.
2. https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
3. Framework: None. Build command: (empty). Output directory: `public`.
4. After first deploy: Settings → Variables and Secrets → add secret `GEMINI_API_KEY` (and optionally `PROVIDER=groq` + `GROQ_API_KEY`). Redeploy.
5. Your site is live at `https://<project>.pages.dev` (free subdomain).
6. Replace `YOUR-PROJECT.pages.dev` with your real URL in `public/index.html`, `sitemap.xml`, `robots.txt`; commit.
(Vercel alternative: move `functions/api/chat.js` to `api/chat.js` and adapt to Vercel's handler signature.)

## 3. Google indexing
1. https://search.google.com/search-console → Add property → "URL prefix" with your pages.dev URL.
2. Verify with the HTML-tag method: paste the `<meta name="google-site-verification" ...>` tag into `<head>` of `public/index.html`, redeploy, click Verify.
3. Sitemaps → submit `sitemap.xml`.
4. URL Inspection → paste your homepage → Request indexing.
Indexing can take days to weeks and ranking is never guaranteed; a brand-name search like "Nova AI" is very competitive.

## Free-tier limitations
- Gemini free quota is limited per minute/day and varies by model; when exhausted, Nova shows an honest "quota used up" message.
- Cloudflare Functions free plan: ~100k requests/day.
- Rate limiting is in-memory per server instance (basic protection only). For stronger limits use Cloudflare's free rate-limiting rules.
- Chat history lives in each user's browser (localStorage): not synced across devices, cleared if browser data is cleared.
- Free-tier Google data may be used to improve Google's products; see privacy.html and tell users.
