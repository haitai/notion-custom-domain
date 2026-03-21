import express from 'express';
import proxy from 'express-http-proxy';
import { URL } from 'url';
import path from 'path';
import { minify_sync as minify } from 'terser';
import CleanCSS from 'clean-css';

const {
  PAGE_URL = 'https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
  GA_MEASUREMENT_ID,
  VERCEL_GIT_COMMIT_SHA,
} = process.env;

const assetVersion = VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || `${Date.now()}`;
const LARGE_FILE_SIZE_BYTES = 500000;
const GOOGLE_ANALYTICS_SOURCES =
  'https://www.googletagmanager.com https://www.google-analytics.com';
const CUSTOM_STYLE = `
  .notion-topbar > div > div:nth-last-child(1), .notion-topbar > div > div:nth-last-child(2) {
    display:none !important;
  }
  .notion-topbar-mobile > div:nth-child(2) > div:nth-child(2) {
    display:none !important;
  }
`;
const ASSET_URL_PATTERN = /([/"'])((?:\\\/|\/)?_assets\/[^"'?]+\.(?:js|css))(?=["'])/g;
const FIRST_ASSET_SCRIPT_PATTERN = /<script src="\/_assets\//;
const LOCATION_HREF_PATTERN = /window\.location\.href(?=[^=]|={2,})/g;
const ASSET_REQUEST_PATTERN = /^\/_assets\/[^/]*\.js$/;
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
  // Keep a legacy global reference for bundles that still access `ncd` directly.
  // This avoids breakage when upstream assets are cached across deployments.
  Reflect.set(globalThis, 'ncd', window.ncd);

  window.history.pushState = new Proxy(window.history.pushState, {
    apply: function (target, that, [data, unused, url]) {
      return Reflect.apply(target, that, [
        data,
        unused,
        window.ncd._yourUrl(url),
      ]);
    },
  });
  window.history.replaceState = new Proxy(window.history.replaceState, {
    apply: function (target, that, [data, unused, url]) {
      return Reflect.apply(target, that, [
        data,
        unused,
        window.ncd._yourUrl(url),
      ]);
    },
  });
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

function getInjectedHeadMarkup() {
  return `<script>${getLocationProxyScript()}</script>${getCustomScript()}${getCustomStyle()}`;
}

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

function isLargeResponse(buffer: Buffer) {
  return buffer.length > LARGE_FILE_SIZE_BYTES;
}

function rewriteRuntimeAsset(data: string) {
  return data.replace(LOCATION_HREF_PATTERN, 'window.ncd.href()');
}

function rewriteHtml(data: string) {
  return data
    .replace(ASSET_URL_PATTERN, `$1$2?v=${assetVersion}`)
    // Load our globals before Notion's async bundles to avoid race conditions.
    .replace(
      FIRST_ASSET_SCRIPT_PATTERN,
      `${getInjectedHeadMarkup()}<script src="/_assets/`,
    )
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

const app = express();

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

      return headers;
    },
    userResDecorator: (_proxyRes, proxyResData, userReq) => {
      if (PASSTHROUGH_REQUEST_PATTERN.test(userReq.url)) {
        return proxyResData;
      }

      if (isLargeResponse(proxyResData)) {
        console.warn(
          'Skipping large file:',
          userReq.url,
          `(${proxyResData.length} bytes)`,
        );
        return proxyResData;
      }

      const data = proxyResData.toString();

      // For investigation
      const keywords: string[] = [
        // 'teV1',
        // 'aif.notion.so',
        // 'exp.notion.so',
        // 'msgstore.www.notion.so',
        // 'primus',
        // 'widget.intercom.io',
        // 'ingest.sentry.io',
        // 'envelope',
        // 'dsn',
        // 'splunkcloud.com',
        // 'statsigapi.net',
      ];
      const found = keywords.reduce(
        (acc: string[], keyword) =>
          data.includes(keyword) ? [...acc, keyword] : acc,
        [],
      );
      if (found.length > 0) {
        console.log('[DEBUG]', userReq.url, found);
      }

      return decorateHtmlOrAssetResponse(data, userReq.url);
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
