---
name: Monitoring alert
about: Follow-up template for production smoke monitor failures
title: 'Monitoring alert: production smoke test failed'
labels: monitoring
---

## Summary

- Failed workflow run:
- Site URL:
- First failing check:

## Evidence

- Artifact reviewed:
- Relevant response headers:
- Relevant HTML snippet:

## Likely Cause

- [ ] Upstream Notion DOM changed
- [ ] Proxy response changed
- [ ] Custom script/style injection failed
- [ ] Deployment/domain outage
- [ ] Other

## Next Action

- [ ] Reproduce locally
- [ ] Prepare fix PR
- [ ] Re-run monitor after deploy
