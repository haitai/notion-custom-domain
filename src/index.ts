import express from 'express';
import proxy from 'express-http-proxy';
import { URL } from 'url';
import path from 'path';
import { minify_sync as minify } from 'terser';
import CleanCSS from 'clean-css';

const {
  PAGE_URL = 'https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
  GA_MEASUREMENT_ID,
} = process.env;

const GOOGLE_ANALYTICS_SOURCES =
  'https://www.googletagmanager.com https://www.google-analytics.com';
const CUSTOM_STYLE = `
 // .notion-topbar > div > div:nth-last-child(1), .notion-topbar > div > div:nth-last-child(2) {
 //   display:none !important;
 // }
  .notion-topbar-mobile > div:nth-child(2) > div:nth-child(2) {
    display:none !important;
  }
  .notion-topbar > div > div:nth-last-child(1) > div > div:nth-last-child(1),.notion-topbar > div > div:nth-last-child(1) > div > div:nth-last-child(2), div.notion-topbar-mobile > div:nth-last-child(1) > div:first-child,div[role="menuitem"]:last-child, .notion-selectable-container > div > div:nth-of-type(4) > div:nth-of-type(1) { 
      display:none !important;
  }
`;
const LOCATION_HREF_PATTERN = /window\.location\.href(?=[^=]|={2,})/g;
const ASSET_REQUEST_PATTERN = /^\/_assets\/[^/]*\.js$/;
const STATIC_ASSET_PATTERN = /^\/_assets\//;
const PASSTHROUGH_REQUEST_PATTERN = /^\/(image[s]?|api)\//;
const PUBLIC_PAGE_DATA_ENDPOINT = '/200/www.notion.so/api/v3/';
const EXPERIMENT_ENDPOINT = '/200/exp.notion.so/v1/';

const { origin: pageDomain, pathname: pagePath } = new URL(PAGE_URL);
const [pageId] = path.basename(pagePath).match(/[^-]*$/) || [''];

// Map start page path to "/". Replacing URL for example:
// - https://my.notion.site/0123456789abcdef0123456789abcdef -> https://mydomain.com/
// - /My-Page-0123456789abcdef0123456789abcdef -> /
// - /my/My-Page-0123456789abcdef0123456789abcdef -> /
declare global {
  interface Window {
    ncd: {
      _pageId: string;
      _pageDomain: string;
      _myUrl: (url: string) => string;
      _yourUrl: (url: string) => string;
      href: () => string;
    };
  }
}
const locationProxy = (pageDomain: string, pageId: string) => {
  window.ncd = {
    _pageId: pageId,
    _pageDomain: pageDomain,
    _myUrl: function (url: string) {
      return url
        .replace(location.origin, this._pageDomain)
        .replace(/\/(?=\?|$)/, `/${this._pageId}`);
    },
    _yourUrl: function (url: string) {
      return url
        .replace(this._pageDomain, location.origin)
        .replace(
          new RegExp(`(^|[^/])\\/[^/].*${this._pageId}(?=\\?|$)`),
          '$1/',
        );
    },
    href: function () {
      return this._myUrl(location.href);
    },
  };

  const proxyHistoryMethod = (method: typeof window.history.pushState) =>
    new Proxy(method, {
      apply: function (target, that, [data, unused, url]) {
        return Reflect.apply(target, that, [
          data,
          unused,
          window.ncd._yourUrl(url),
        ]);
      },
    });
  window.history.pushState = proxyHistoryMethod(window.history.pushState);
  window.history.replaceState = proxyHistoryMethod(window.history.replaceState);
};

function minifyExpression(expression: string) {
  return minify(expression).code;
}

function getLocationProxyScript() {
  return minifyExpression(
    `(${locationProxy.toString()})('${pageDomain}', '${pageId}')`,
  );
}

const ga = GA_MEASUREMENT_ID
  ? `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_MEASUREMENT_ID}');
</script>`
  : '';

const customScript = () => {
  const replacedUrl = (url: string) => {
    const [, domain] = /^https?:\/\/([^\\/]*)/.exec(url) || ['', ''];
    if (
      (domain.endsWith('notion.so') &&
        !domain.endsWith('msgstore.www.notion.so')) ||
      domain.endsWith('splunkcloud.com') ||
      domain.endsWith('statsigapi.net')
    ) {
      console.info('[NCD]', 'Suppress request:', url);
      return url.replace(/^.*:(.*)\/\//, '/200/$1');
    }
    return url;
  };

  window.fetch = new Proxy(window.fetch, {
    apply: function (target, that, [url, ...rest]) {
      url = replacedUrl(url);
      return Reflect.apply(target, that, [url, ...rest]);
    },
  });

  window.XMLHttpRequest = new Proxy(XMLHttpRequest, {
    construct: function (target, args) {
      // @ts-expect-error A spread argument must either have a tuple type or be passed to a rest parameter.
      const xhr = new target(...args);
      xhr.open = new Proxy(xhr.open, {
        apply: function (target, that, [method, url, ...rest]) {
          url = replacedUrl(url);
          return Reflect.apply(target, that, [method, url, ...rest]);
        },
      });
      return xhr;
    },
  });
};

function getCustomScript() {
  const js = minifyExpression(`(${customScript.toString()})()`);
  return `<script>${js}</script>`;
}

function getCustomStyle() {
  const css = new CleanCSS().minify(CUSTOM_STYLE).styles;
  return `<style>${css}</style>`;
}

const injectedHeadMarkup = `<script>${getLocationProxyScript()}</script>${getCustomScript()}${getCustomStyle()}`;

function getProxyPath(url: string) {
  return url.replace(/\/(\?|$)/, `/${pageId}$1`);
}

function rewriteCookieDomains(cookies: string[], hostname: string) {
  return cookies.map((cookie) =>
    cookie.replace(
      /((?:^|; )Domain=)(?:[^.]+\.)?notion\.site(;|$)/gi,
      `$1${hostname}$2`,
    ),
  );
}

function addAnalyticsSourcesToCsp(csp: string) {
  return csp.replace(
    /(?=(script-src|connect-src) )[^;]*/g,
    `$& ${GOOGLE_ANALYTICS_SOURCES}`,
  );
}

function isPseudoSuccessEndpoint(url: string) {
  return /^\/200\/?/.test(url);
}

function handlePseudoSuccessEndpoint(url: string, res: express.Response) {
  if (url.startsWith(PUBLIC_PAGE_DATA_ENDPOINT)) {
    res.send('success');
  } else if (url.startsWith(EXPERIMENT_ENDPOINT)) {
    res.json({ success: true });
  } else {
    res.end();
  }
}

function rewriteRuntimeAsset(data: string) {
  return data.replace(LOCATION_HREF_PATTERN, 'window.ncd.href()');
}

function rewriteHtml(data: string) {
  return data
    .replace('</head>', `${injectedHeadMarkup}</head>`)
    .replace('</body>', `${ga}</body>`);
}

function rewriteSharedResponseContent(data: string) {
  return data
    .replace(
      /https:\/\/((aif\.notion\.so|widget\.intercom\.io)\/?[^"`]*)/g,
      `/200/$1`,
    )
    .replace(/\w+\.init\({dsn:/, 'return;$&');
}

function decorateHtmlOrAssetResponse(data: string, requestUrl: string) {
  const rewritten = ASSET_REQUEST_PATTERN.test(requestUrl)
    ? rewriteRuntimeAsset(data)
    : rewriteHtml(data);

  return rewriteSharedResponseContent(rewritten);
}

// Filenames under /_assets/ are content-hashed, so responses are immutable.
interface CacheEntry {
  data: Buffer | string;
  contentType: string;
}
const assetCache = new Map<string, CacheEntry>();

const app = express();

app.use((req, res, next) => {
  const cached = assetCache.get(req.url);
  if (cached) {
    res.setHeader('content-type', cached.contentType);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.send(cached.data);
    return;
  }
  next();
});

app.use(
  proxy(pageDomain, {
    proxyReqOptDecorator: (proxyReqOpts) => {
      if (proxyReqOpts.headers) {
        delete proxyReqOpts.headers['accept-encoding'];
      }
      return proxyReqOpts;
    },
    filter: (req, res) => {
      if (isPseudoSuccessEndpoint(req.url)) {
        handlePseudoSuccessEndpoint(req.url, res);
        return false;
      }
      return true;
    },
    proxyReqPathResolver: (req) => {
      return getProxyPath(req.url);
    },
    userResHeaderDecorator: (headers, userReq) => {
      const cookies = headers['set-cookie'];
      if (cookies) {
        headers['set-cookie'] = rewriteCookieDomains(cookies, userReq.hostname);
      }

      const csp = headers['content-security-policy'] as string;
      if (csp) {
        headers['content-security-policy'] = addAnalyticsSourcesToCsp(csp);
      }

      if (STATIC_ASSET_PATTERN.test(userReq.url)) {
        headers['cache-control'] = 'public, max-age=31536000, immutable';
      }

      return headers;
    },
    userResDecorator: (proxyRes, proxyResData, userReq) => {
      const contentType = proxyRes.headers['content-type'] ?? '';
      if (
        PASSTHROUGH_REQUEST_PATTERN.test(userReq.url) ||
        !contentType.startsWith('text/') && !contentType.includes('javascript')
      ) {
        if (
          STATIC_ASSET_PATTERN.test(userReq.url) &&
          proxyRes.statusCode === 200
        ) {
          assetCache.set(userReq.url, { data: proxyResData, contentType });
        }
        return proxyResData;
      }

      const data = proxyResData.toString();
      const result = decorateHtmlOrAssetResponse(data, userReq.url);

      if (
        STATIC_ASSET_PATTERN.test(userReq.url) &&
        proxyRes.statusCode === 200
      ) {
        assetCache.set(userReq.url, { data: result, contentType });
      }

      return result;
    },
  }),
);

if (!process.env.VERCEL_REGION && !process.env.NOW_REGION) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Server running at http://localhost:${port}`),
  );
}

export default app;
