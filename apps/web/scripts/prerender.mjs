import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// Render the same component as the browser, without a second copy of landing text.
// Other SPA routes receive the original empty shell, never the landing HTML.
const server=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true},appType:'custom'});
try {
  const {default:Landing}=await server.ssrLoadModule('/src/Landing.tsx');
  const {siteOrigin,landingTitle,landingDescription,websiteSchema}=await server.ssrLoadModule('/src/seo.ts');
  const template=await readFile('dist/index.html','utf8');
  await writeFile('dist/app-shell.html',template);
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const metadata=`<link rel="canonical" href="${siteOrigin}/" />
    <meta property="og:url" content="${siteOrigin}/" />
    <meta property="og:site_name" content="Trajetico" />
    <meta property="og:image" content="${siteOrigin}/brand/trajetico-logo-full.png" />
    <meta property="og:image:alt" content="Trajetico — comparez les carburants dans le 64" />
    <meta name="twitter:card" content="summary" />
    <script id="website-schema" type="application/ld+json">${JSON.stringify(websiteSchema).replaceAll('<','\\u003c')}</script>`;
  const html=template.replace(/<title>.*?<\/title>/,`<title>${escape(landingTitle)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/,`$1${escape(landingDescription)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/,`$1${escape(landingTitle)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/,`$1${escape(landingDescription)}`)
    .replace('</head>',`${metadata}\n</head>`)
    .replace('<div id="root"></div>',`<div id="root">${renderToString(createElement(Landing))}</div>`);
  await writeFile('dist/index.html',html);
  await writeFile('dist/robots.txt',`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteOrigin}/sitemap.xml\n`);
  await writeFile('dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteOrigin}/</loc></url></urlset>\n`);
  console.log('Prerendered landing, SPA shell, robots.txt and sitemap.xml.');
} finally {await server.close();}
