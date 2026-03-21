# Notion Custom Domain

Custom domains for your Notion pages. You can publish your page to your own domain instead of `notion.site`.

[![Notion Custom Domain](https://user-images.githubusercontent.com/19500280/93695277-d99aa400-fb4f-11ea-8e82-5c431110ce19.png)](https://notion-custom-domain.hosso.co)

## Getting Started

Install dependencies:

```
yarn
```

Then deploy to Vercel with specifying your public Notion page:

```
PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID> \
yarn deploy:prod
```

For example:

```
PAGE_URL=https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8 \
yarn deploy:prod
```

Finally, set up a custom domain for the deployment on the Vercel Dashboard. See [Custom Domains – Vercel Docs](https://vercel.com/docs/concepts/projects/custom-domains)

![](https://user-images.githubusercontent.com/19500280/169642461-c31df143-a8a5-4d37-8494-e5b04b01c7b1.png)

## Development

### Run locally

```
PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID> \
yarn dev
```

Then open http://localhost:3000.

### Debug with Node Inspector

```
PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID> \
yarn debug
```

Then open http://localhost:3000.

## Google Analytics Support

Deploying with `GA_MEASUREMENT_ID` environment variable injects the tracking code into your public Notion page:

```
PAGE_URL=https://<your-domain>.notion.site/<Your-Page-ID> \
GA_MEASUREMENT_ID=G-XXXXXXXXXX \
yarn deploy:prod
```

## Using Environment Variables on the Vercel Dashboard

You can use environment variables on the Vercel Dashboard. In this case, you can simply run
`vercel env pull`, `vercel dev`, `vercel deploy` or `vercel deploy --prod` without setting environment variables.
![](https://github.com/hosso/notion-custom-domain/assets/19500280/e234a2eb-8ba7-4be0-a1dd-fa58ce0327ab)

## Production Monitoring

This repository includes a scheduled GitHub Actions workflow at `.github/workflows/monitor.yml`.
It runs every 6 hours and can also be started manually from the Actions tab.

Set the repository variable `SITE_URL` to the deployed custom domain URL you want to monitor, for example:

```text
https://notion-custom-domain.hosso.co
```

The monitor checks that the site:

- returns an HTTP success status
- serves HTML
- injects the custom location proxy script
- injects the custom style override

When the check fails, the workflow:

- uploads the HTML, headers, and JSON summary as artifacts
- opens or updates a GitHub issue titled `Monitoring alert: production smoke test failed`

The investigation steps are documented in [`docs/monitoring.md`](docs/monitoring.md).

You can also run the same check locally:

```sh
SITE_URL=https://notion-custom-domain.hosso.co yarn monitor:smoke
```

## License

[MIT](LICENSE)
