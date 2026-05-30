# Reliability Baseline Report

Generated: 2026-05-30T16:55:29.259Z

## Overview

- Total operations tracked: 17
- Total checks recorded: 51
- Total pass rate: 100.00%
- Global p95 runtime: 22 ms

## Per-operation

| Operation | Tier | Checks | Pass | Fail | Pass rate | p95 ms | Expected fixtures |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PDF image watermark (pdf.watermark.image) | A | 2 | 2 | 0 | 100.00% | 16 | 2 |
| PDF text watermark (pdf.watermark.text) | A | 2 | 2 | 0 | 100.00% | 22 | 2 |
| PDF repair (pdf.repair) | A | 2 | 2 | 0 | 100.00% | 31 | 2 |
| PDF crop (pdf.crop) | A | 2 | 2 | 0 | 100.00% | 2 | 2 |
| PDF reorder (pdf.reorder) | A | 3 | 3 | 0 | 100.00% | 5 | 3 |
| PDF split by size (pdf.split.size) | B | 2 | 2 | 0 | 100.00% | 6 | 2 |
| PDF/A export (pdf.pdfa.export) | B | 3 | 3 | 0 | 100.00% | 0 | 3 |
| PDF metadata batch (pdf.metadata.batch) | B | 2 | 2 | 0 | 100.00% | 2 | 2 |
| PDF output naming (pdf.output.naming) | B | 2 | 2 | 0 | 100.00% | 1 | 2 |
| PDF protect presets (pdf.protect.presets) | B | 3 | 3 | 0 | 100.00% | 0 | 3 |
| PDF header/footer presets (pdf.header-footer.presets) | B | 2 | 2 | 0 | 100.00% | 4 | 2 |
| PDF lock/unlock policy (pdf.lock-unlock.policy) | A | 8 | 8 | 0 | 100.00% | 0 | 8 |
| PDF unlock runtime (pdf.unlock.runtime) | A | 3 | 3 | 0 | 100.00% | 39 | 3 |
| PDF repair unlock interaction (pdf.repair.unlock-interaction) | A | 2 | 2 | 0 | 100.00% | 1 | 2 |
| PDF OCR pilot (pdf.ocr.pilot) | A | 1 | 1 | 0 | 100.00% | 0 | 1 |
| Office conversion reliability (content.office.reliability) | B | 7 | 7 | 0 | 100.00% | 0 | 7 |
| Tier A route smoke (app.tier-a.route-smoke) | A | 5 | 5 | 0 | 100.00% | 0 | 5 |

